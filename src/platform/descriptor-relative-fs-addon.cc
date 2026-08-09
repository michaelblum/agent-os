#define NAPI_VERSION 8

#ifndef NODE_GYP_MODULE_NAME
#define NODE_GYP_MODULE_NAME descriptor_relative_fs
#endif

#include <node_api.h>

#if !defined(__APPLE__)
#error "The descriptor-relative Work Record filesystem primitive currently requires Darwin."
#endif

#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <limits.h>
#include <sys/event.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <stdio.h>
#include <unistd.h>

#include <array>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr size_t kMaximumPayloadBytes = 32U * 1024U * 1024U;
constexpr size_t kMaximumPathSegments = 128U;
constexpr size_t kMaximumHookEvents = 16U;

struct UniqueFD {
  int value = -1;

  UniqueFD() = default;
  explicit UniqueFD(int fd) : value(fd) {}
  UniqueFD(const UniqueFD&) = delete;
  UniqueFD& operator=(const UniqueFD&) = delete;
  UniqueFD(UniqueFD&& other) noexcept : value(other.value) { other.value = -1; }
  UniqueFD& operator=(UniqueFD&& other) noexcept {
    if (this != &other) {
      reset();
      value = other.value;
      other.value = -1;
    }
    return *this;
  }
  ~UniqueFD() { reset(); }

  void reset(int fd = -1) {
    if (value >= 0) close(value);
    value = fd;
  }
};

struct FileIdentity {
  uint64_t device = 0;
  uint64_t inode = 0;
  uint64_t links = 0;
  bool present = false;
};

struct DirectoryEntry {
  std::string name;
  UniqueFD descriptor;
  struct stat snapshot {};
};

struct DirectoryChain {
  std::vector<DirectoryEntry> entries;
  size_t boundaryIndex = 0;
};

struct HookOutcome {
  bool callbackFailed = false;
  std::string failOperation;
};

struct NativeResult {
  std::string status;
  bool published = false;
  bool tempFileLeftover = false;
  bool destinationFileLeftover = false;
  bool contentScrubbed = false;
  std::string existingKind;
  std::string existingDigest;
  std::string tempFile;
  std::string errorCode;
  std::string errorMessage;
  std::string cleanupErrorCode;
  std::string cleanupErrorMessage;
  FileIdentity identity;
  FileIdentity rootIdentity;
  std::vector<FileIdentity> directoryChain;
  std::vector<uint8_t> bytes;
  bool includeBytes = false;
};

struct ParsedRequest {
  std::string rootPath;
  std::vector<std::string> relativeSegments;
  const uint8_t* bytes = nullptr;
  size_t byteCount = 0;
  bool hasBytes = false;
  FileIdentity expectedIdentity;
  napi_value hook = nullptr;
  bool hasHook = false;
};

FileIdentity IdentityFromStat(const struct stat& value) {
  return {
    static_cast<uint64_t>(value.st_dev),
    static_cast<uint64_t>(value.st_ino),
    static_cast<uint64_t>(value.st_nlink),
    true,
  };
}

bool SameIdentity(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino;
}

bool SameSnapshot(const struct stat& left, const struct stat& right) {
  return SameIdentity(left, right)
    && left.st_mode == right.st_mode
    && left.st_size == right.st_size
    && left.st_nlink == right.st_nlink
    && left.st_mtimespec.tv_sec == right.st_mtimespec.tv_sec
    && left.st_mtimespec.tv_nsec == right.st_mtimespec.tv_nsec
    && left.st_ctimespec.tv_sec == right.st_ctimespec.tv_sec
    && left.st_ctimespec.tv_nsec == right.st_ctimespec.tv_nsec;
}

std::string ErrnoMessage(int value) {
  const char* message = strerror(value);
  return message == nullptr ? "Filesystem operation failed." : std::string(message);
}

std::string Sha256(const uint8_t* bytes, size_t count) {
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest {};
  CC_SHA256(bytes, static_cast<CC_LONG>(count), digest.data());
  static constexpr char hex[] = "0123456789abcdef";
  std::string result;
  result.resize(digest.size() * 2U);
  for (size_t index = 0; index < digest.size(); ++index) {
    result[index * 2U] = hex[(digest[index] >> 4U) & 0x0fU];
    result[index * 2U + 1U] = hex[digest[index] & 0x0fU];
  }
  return result;
}

bool GetNamedValue(napi_env env, napi_value object, const char* name, napi_value* output) {
  bool hasProperty = false;
  if (napi_has_named_property(env, object, name, &hasProperty) != napi_ok || !hasProperty) return false;
  return napi_get_named_property(env, object, name, output) == napi_ok;
}

bool GetString(napi_env env, napi_value value, std::string* output) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t count = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &count) != napi_ok) return false;
  std::vector<char> buffer(count + 1U, '\0');
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &written) != napi_ok) return false;
  output->assign(buffer.data(), written);
  return true;
}

bool GetNamedString(napi_env env, napi_value object, const char* name, std::string* output) {
  napi_value value;
  return GetNamedValue(env, object, name, &value) && GetString(env, value, output);
}

bool ParseUnsigned(napi_env env, napi_value value, uint64_t* output) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok) return false;
  if (type == napi_bigint) {
    bool lossless = false;
    return napi_get_value_bigint_uint64(env, value, output, &lossless) == napi_ok && lossless;
  }
  if (type == napi_number) {
    double number = 0;
    if (napi_get_value_double(env, value, &number) != napi_ok || number < 0) return false;
    *output = static_cast<uint64_t>(number);
    return static_cast<double>(*output) == number;
  }
  if (type == napi_string) {
    std::string stringValue;
    if (!GetString(env, value, &stringValue) || stringValue.empty()) return false;
    char* end = nullptr;
    errno = 0;
    unsigned long long parsed = strtoull(stringValue.c_str(), &end, 10);
    if (errno != 0 || end == nullptr || *end != '\0') return false;
    *output = static_cast<uint64_t>(parsed);
    return true;
  }
  return false;
}

bool ParseIdentity(napi_env env, napi_value object, FileIdentity* output) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, object, &type) != napi_ok || type != napi_object) return false;
  napi_value device;
  napi_value inode;
  uint64_t parsedDevice = 0;
  uint64_t parsedInode = 0;
  if (!GetNamedValue(env, object, "dev", &device)
      || !GetNamedValue(env, object, "ino", &inode)
      || !ParseUnsigned(env, device, &parsedDevice)
      || !ParseUnsigned(env, inode, &parsedInode)) return false;
  output->device = parsedDevice;
  output->inode = parsedInode;
  output->present = true;
  return true;
}

bool ValidSegment(const std::string& value) {
  return !value.empty()
    && value != "."
    && value != ".."
    && value.size() <= NAME_MAX
    && value.find('/') == std::string::npos
    && value.find('\0') == std::string::npos;
}

std::vector<std::string> SplitAbsolutePath(const std::string& path, bool* valid) {
  std::vector<std::string> result;
  *valid = !path.empty() && path.front() == '/' && path.size() <= PATH_MAX;
  if (!*valid) return result;
  size_t start = 1;
  while (start <= path.size()) {
    size_t end = path.find('/', start);
    if (end == std::string::npos) end = path.size();
    if (end > start) {
      std::string segment = path.substr(start, end - start);
      if (!ValidSegment(segment)) {
        *valid = false;
        return {};
      }
      result.push_back(std::move(segment));
    }
    if (end == path.size()) break;
    start = end + 1U;
  }
  if (result.empty()) *valid = false;
  return result;
}

bool NormalizeFirstSystemSymlink(std::vector<std::string>* components) {
  if (components->empty()) return false;
  std::string firstPath = "/" + components->front();
  struct stat firstStat {};
  if (lstat(firstPath.c_str(), &firstStat) != 0 || !S_ISLNK(firstStat.st_mode)) return true;
  const bool allowedSystemLink = firstStat.st_uid == 0
    && (firstPath == "/etc" || firstPath == "/tmp" || firstPath == "/var");
  if (!allowedSystemLink) return false;
  std::array<char, PATH_MAX + 1U> resolved {};
  if (realpath(firstPath.c_str(), resolved.data()) == nullptr) return false;
  if (std::string(resolved.data()) != "/private" + firstPath) return false;
  bool valid = false;
  std::vector<std::string> physical = SplitAbsolutePath(resolved.data(), &valid);
  if (!valid) return false;
  physical.insert(physical.end(), components->begin() + 1, components->end());
  *components = std::move(physical);
  return true;
}

std::string JoinPath(const std::string& root, const std::vector<std::string>& segments, size_t count) {
  std::string result = root;
  while (result.size() > 1U && result.back() == '/') result.pop_back();
  for (size_t index = 0; index < count; ++index) {
    result.push_back('/');
    result.append(segments[index]);
  }
  return result;
}

bool ParseRequest(napi_env env, napi_value input, bool requireBytes, ParsedRequest* output, std::string* error) {
  napi_valuetype inputType = napi_undefined;
  if (napi_typeof(env, input, &inputType) != napi_ok || inputType != napi_object) {
    *error = "Request must be an object.";
    return false;
  }
  if (!GetNamedString(env, input, "rootPath", &output->rootPath)) {
    *error = "rootPath must be an absolute path string.";
    return false;
  }
  bool rootValid = false;
  std::vector<std::string> rootSegments = SplitAbsolutePath(output->rootPath, &rootValid);
  if (!rootValid || rootSegments.empty()) {
    *error = "rootPath must identify a non-root absolute boundary.";
    return false;
  }

  napi_value segmentsValue;
  bool isArray = false;
  uint32_t segmentCount = 0;
  if (!GetNamedValue(env, input, "relativeSegments", &segmentsValue)
      || napi_is_array(env, segmentsValue, &isArray) != napi_ok
      || !isArray
      || napi_get_array_length(env, segmentsValue, &segmentCount) != napi_ok
      || segmentCount == 0
      || segmentCount > kMaximumPathSegments) {
    *error = "relativeSegments must contain one bounded destination path.";
    return false;
  }
  output->relativeSegments.reserve(segmentCount);
  for (uint32_t index = 0; index < segmentCount; ++index) {
    napi_value segmentValue;
    std::string segment;
    if (napi_get_element(env, segmentsValue, index, &segmentValue) != napi_ok
        || !GetString(env, segmentValue, &segment)
        || !ValidSegment(segment)) {
      *error = "relativeSegments contains an invalid or ambiguous path segment.";
      return false;
    }
    output->relativeSegments.push_back(std::move(segment));
  }

  napi_value bytesValue;
  if (GetNamedValue(env, input, "bytes", &bytesValue)) {
    bool isBuffer = false;
    if (napi_is_buffer(env, bytesValue, &isBuffer) != napi_ok || !isBuffer) {
      *error = "bytes must be a Buffer.";
      return false;
    }
    void* bytes = nullptr;
    size_t count = 0;
    if (napi_get_buffer_info(env, bytesValue, &bytes, &count) != napi_ok || count > kMaximumPayloadBytes) {
      *error = "bytes exceeds the bounded native publication size.";
      return false;
    }
    output->bytes = static_cast<const uint8_t*>(bytes);
    output->byteCount = count;
    output->hasBytes = true;
  } else if (requireBytes) {
    *error = "bytes is required.";
    return false;
  }

  napi_value expectedIdentity;
  if (GetNamedValue(env, input, "expectedIdentity", &expectedIdentity)) {
    napi_valuetype expectedType = napi_undefined;
    napi_typeof(env, expectedIdentity, &expectedType);
    if (expectedType != napi_null && expectedType != napi_undefined
        && !ParseIdentity(env, expectedIdentity, &output->expectedIdentity)) {
      *error = "expectedIdentity must contain exact dev and ino values.";
      return false;
    }
  }

  napi_value hook;
  if (GetNamedValue(env, input, "hook", &hook)) {
    napi_valuetype hookType = napi_undefined;
    if (napi_typeof(env, hook, &hookType) != napi_ok || hookType != napi_function) {
      *error = "hook must be a function when provided.";
      return false;
    }
    output->hook = hook;
    output->hasHook = true;
  }
  return true;
}

bool SetNamedString(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value stringValue;
  return napi_create_string_utf8(env, value.c_str(), value.size(), &stringValue) == napi_ok
    && napi_set_named_property(env, object, name, stringValue) == napi_ok;
}

bool SetNamedBool(napi_env env, napi_value object, const char* name, bool value) {
  napi_value boolValue;
  return napi_get_boolean(env, value, &boolValue) == napi_ok
    && napi_set_named_property(env, object, name, boolValue) == napi_ok;
}

napi_value IdentityValue(napi_env env, const FileIdentity& identity) {
  napi_value object;
  napi_create_object(env, &object);
  SetNamedString(env, object, "dev", std::to_string(identity.device));
  SetNamedString(env, object, "ino", std::to_string(identity.inode));
  SetNamedString(env, object, "nlink", std::to_string(identity.links));
  return object;
}

napi_value ResultValue(napi_env env, const NativeResult& result) {
  napi_value object;
  napi_create_object(env, &object);
  SetNamedString(env, object, "status", result.status);
  SetNamedBool(env, object, "published", result.published);
  SetNamedBool(env, object, "temp_file_leftover", result.tempFileLeftover);
  SetNamedBool(env, object, "destination_file_leftover", result.destinationFileLeftover);
  SetNamedBool(env, object, "content_scrubbed", result.contentScrubbed);
  if (!result.existingKind.empty()) SetNamedString(env, object, "existing_kind", result.existingKind);
  if (!result.existingDigest.empty()) SetNamedString(env, object, "existing_digest", result.existingDigest);
  if (!result.tempFile.empty()) SetNamedString(env, object, "temp_file", result.tempFile);
  if (!result.errorCode.empty()) SetNamedString(env, object, "error_code", result.errorCode);
  if (!result.errorMessage.empty()) SetNamedString(env, object, "error_message", result.errorMessage);
  if (!result.cleanupErrorCode.empty()) SetNamedString(env, object, "cleanup_error_code", result.cleanupErrorCode);
  if (!result.cleanupErrorMessage.empty()) SetNamedString(env, object, "cleanup_error_message", result.cleanupErrorMessage);
  if (result.identity.present) napi_set_named_property(env, object, "identity", IdentityValue(env, result.identity));
  if (result.rootIdentity.present) napi_set_named_property(env, object, "root_identity", IdentityValue(env, result.rootIdentity));
  if (!result.directoryChain.empty()) {
    napi_value array;
    napi_create_array_with_length(env, result.directoryChain.size(), &array);
    for (size_t index = 0; index < result.directoryChain.size(); ++index) {
      napi_set_element(env, array, static_cast<uint32_t>(index), IdentityValue(env, result.directoryChain[index]));
    }
    napi_set_named_property(env, object, "directory_chain", array);
  }
  if (result.includeBytes) {
    napi_value buffer;
    napi_create_buffer_copy(env, result.bytes.size(), result.bytes.data(), nullptr, &buffer);
    napi_set_named_property(env, object, "bytes", buffer);
  }
  return object;
}

NativeResult Failure(const std::string& status, const std::string& code, const std::string& message, bool published = false) {
  NativeResult result;
  result.status = status;
  result.published = published;
  result.errorCode = code;
  result.errorMessage = message;
  return result;
}

enum class ChainStatus {
  kOpened,
  kMissing,
  kInvalid,
  kIOFailure,
};

ChainStatus OpenDirectoryChain(
  const ParsedRequest& request,
  bool createMissing,
  DirectoryChain* chain,
  int* errorNumber
) {
  bool rootValid = false;
  std::vector<std::string> components = SplitAbsolutePath(request.rootPath, &rootValid);
  if (!rootValid || !NormalizeFirstSystemSymlink(&components)) {
    *errorNumber = EINVAL;
    return ChainStatus::kInvalid;
  }

  int rootFlags = O_RDONLY | O_DIRECTORY | O_CLOEXEC;
  UniqueFD filesystemRoot(open("/", rootFlags));
  if (filesystemRoot.value < 0) {
    *errorNumber = errno;
    return ChainStatus::kIOFailure;
  }
  DirectoryEntry rootEntry;
  rootEntry.name = "/";
  rootEntry.descriptor = std::move(filesystemRoot);
  if (fstat(rootEntry.descriptor.value, &rootEntry.snapshot) != 0) {
    *errorNumber = errno;
    return ChainStatus::kIOFailure;
  }
  chain->entries.push_back(std::move(rootEntry));

  auto openComponent = [&](const std::string& component, bool allowCreate) -> ChainStatus {
    int parent = chain->entries.back().descriptor.value;
    int flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK;
    int descriptor = openat(parent, component.c_str(), flags);
    if (descriptor < 0 && errno == ENOENT && allowCreate) {
      if (mkdirat(parent, component.c_str(), 0700) != 0 && errno != EEXIST) {
        *errorNumber = errno;
        return ChainStatus::kIOFailure;
      }
      descriptor = openat(parent, component.c_str(), flags);
    }
    if (descriptor < 0) {
      *errorNumber = errno;
      if (errno == ENOENT) return ChainStatus::kMissing;
      if (errno == ELOOP || errno == ENOTDIR) return ChainStatus::kInvalid;
      return ChainStatus::kIOFailure;
    }
    DirectoryEntry entry;
    entry.name = component;
    entry.descriptor.reset(descriptor);
    if (fstat(descriptor, &entry.snapshot) != 0) {
      *errorNumber = errno;
      return ChainStatus::kIOFailure;
    }
    if (!S_ISDIR(entry.snapshot.st_mode)) {
      *errorNumber = ENOTDIR;
      return ChainStatus::kInvalid;
    }
    chain->entries.push_back(std::move(entry));
    return ChainStatus::kOpened;
  };

  for (const std::string& component : components) {
    ChainStatus status = openComponent(component, createMissing);
    if (status != ChainStatus::kOpened) return status;
  }
  chain->boundaryIndex = chain->entries.size() - 1U;
  for (size_t index = 0; index + 1U < request.relativeSegments.size(); ++index) {
    ChainStatus status = openComponent(request.relativeSegments[index], createMissing);
    if (status != ChainStatus::kOpened) return status;
  }
  return ChainStatus::kOpened;
}

bool VerifyDirectoryBindings(const DirectoryChain& chain) {
  for (size_t index = 1; index < chain.entries.size(); ++index) {
    struct stat atParent {};
    if (fstatat(
          chain.entries[index - 1U].descriptor.value,
          chain.entries[index].name.c_str(),
          &atParent,
          AT_SYMLINK_NOFOLLOW
        ) != 0
        || !S_ISDIR(atParent.st_mode)
        || !SameIdentity(atParent, chain.entries[index].snapshot)) return false;
  }
  return true;
}

void AttachChainEvidence(const DirectoryChain& chain, NativeResult* result) {
  if (chain.boundaryIndex < chain.entries.size()) {
    result->rootIdentity = IdentityFromStat(chain.entries[chain.boundaryIndex].snapshot);
  }
  for (size_t index = chain.boundaryIndex; index < chain.entries.size(); ++index) {
    result->directoryChain.push_back(IdentityFromStat(chain.entries[index].snapshot));
  }
}

class RenameWatcher {
 public:
  bool Start(const DirectoryChain& chain, int* errorNumber) {
    queue_.reset(kqueue());
    if (queue_.value < 0) {
      *errorNumber = errno;
      return false;
    }
    for (size_t index = chain.boundaryIndex; index < chain.entries.size(); ++index) {
      struct kevent change {};
      EV_SET(
        &change,
        static_cast<uintptr_t>(chain.entries[index].descriptor.value),
        EVFILT_VNODE,
        EV_ADD | EV_ENABLE | EV_CLEAR,
        NOTE_RENAME | NOTE_DELETE | NOTE_REVOKE,
        0,
        nullptr
      );
      if (kevent(queue_.value, &change, 1, nullptr, 0, nullptr) != 0) {
        *errorNumber = errno;
        return false;
      }
    }
    return true;
  }

  bool Changed(int* errorNumber) const {
    std::array<struct kevent, kMaximumHookEvents> events {};
    struct timespec timeout {0, 0};
    int count = kevent(queue_.value, nullptr, 0, events.data(), static_cast<int>(events.size()), &timeout);
    if (count < 0) {
      *errorNumber = errno;
      return true;
    }
    return count > 0;
  }

 private:
  UniqueFD queue_;
};

class LinkWatcher {
 public:
  bool Start(int descriptor, int* errorNumber) {
    queue_.reset(kqueue());
    if (queue_.value < 0) {
      *errorNumber = errno;
      return false;
    }
    struct kevent change {};
    EV_SET(
      &change,
      static_cast<uintptr_t>(descriptor),
      EVFILT_VNODE,
      EV_ADD | EV_ENABLE | EV_CLEAR,
      NOTE_LINK | NOTE_DELETE | NOTE_REVOKE,
      0,
      nullptr
    );
    if (kevent(queue_.value, &change, 1, nullptr, 0, nullptr) != 0) {
      *errorNumber = errno;
      return false;
    }
    return true;
  }

  bool Changed(int* errorNumber) const {
    struct kevent event {};
    struct timespec timeout {0, 0};
    int count = kevent(queue_.value, nullptr, 0, &event, 1, &timeout);
    if (count < 0) {
      *errorNumber = errno;
      return true;
    }
    return count > 0;
  }

 private:
  UniqueFD queue_;
};

class EntryWatcher {
 public:
  bool Start(int descriptor, int* errorNumber) {
    queue_.reset(kqueue());
    if (queue_.value < 0) {
      *errorNumber = errno;
      return false;
    }
    struct kevent change {};
    EV_SET(
      &change,
      static_cast<uintptr_t>(descriptor),
      EVFILT_VNODE,
      EV_ADD | EV_ENABLE | EV_CLEAR,
      NOTE_WRITE,
      0,
      nullptr
    );
    if (kevent(queue_.value, &change, 1, nullptr, 0, nullptr) != 0) {
      *errorNumber = errno;
      return false;
    }
    return true;
  }

  bool Changed(int* errorNumber) const {
    struct kevent event {};
    struct timespec timeout {0, 0};
    int count = kevent(queue_.value, nullptr, 0, &event, 1, &timeout);
    if (count < 0) {
      *errorNumber = errno;
      return true;
    }
    return count > 0;
  }

 private:
  UniqueFD queue_;
};

HookOutcome CallHook(
  napi_env env,
  const ParsedRequest& request,
  const std::string& operation,
  const std::string& phase,
  const std::string& destinationPath,
  const std::string& tempFile
) {
  HookOutcome outcome;
  if (!request.hasHook) return outcome;
  napi_value event;
  napi_create_object(env, &event);
  SetNamedString(env, event, "operation", operation);
  SetNamedString(env, event, "phase", phase);
  SetNamedString(env, event, "root_path", request.rootPath);
  SetNamedString(env, event, "destination_path", destinationPath);
  SetNamedString(env, event, "temp_file", tempFile);
  napi_value global;
  napi_get_global(env, &global);
  napi_value callbackResult;
  napi_status status = napi_call_function(env, global, request.hook, 1, &event, &callbackResult);
  if (status != napi_ok) {
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    if (pending) {
      napi_value ignored;
      napi_get_and_clear_last_exception(env, &ignored);
    }
    outcome.callbackFailed = true;
    return outcome;
  }
  napi_valuetype resultType = napi_undefined;
  if (napi_typeof(env, callbackResult, &resultType) == napi_ok && resultType == napi_object) {
    GetNamedString(env, callbackResult, "fail_operation", &outcome.failOperation);
  }
  return outcome;
}

bool GuardStable(const DirectoryChain& chain, const RenameWatcher& watcher, int* errorNumber) {
  return VerifyDirectoryBindings(chain) && !watcher.Changed(errorNumber);
}

std::string ExistingKind(const struct stat& value) {
  if (S_ISLNK(value.st_mode)) return "symlink";
  if (!S_ISREG(value.st_mode)) return "non_file";
  if (value.st_nlink != 1) return "multiple_links";
  return "file";
}

bool ReadBoundedFile(int descriptor, const struct stat& opened, std::vector<uint8_t>* bytes, int* errorNumber) {
  if (opened.st_size < 0 || static_cast<uint64_t>(opened.st_size) > kMaximumPayloadBytes) {
    *errorNumber = EFBIG;
    return false;
  }
  bytes->assign(static_cast<size_t>(opened.st_size), 0);
  size_t offset = 0;
  while (offset < bytes->size()) {
    ssize_t count = pread(descriptor, bytes->data() + offset, bytes->size() - offset, static_cast<off_t>(offset));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      *errorNumber = count == 0 ? EIO : errno;
      return false;
    }
    offset += static_cast<size_t>(count);
  }
  uint8_t extra = 0;
  ssize_t extraCount = pread(descriptor, &extra, 1, static_cast<off_t>(bytes->size()));
  if (extraCount < 0 && errno != EINTR) {
    *errorNumber = errno;
    return false;
  }
  if (extraCount > 0) {
    *errorNumber = EBUSY;
    return false;
  }
  return true;
}

NativeResult InspectWithChain(
  napi_env env,
  const ParsedRequest& request,
  const DirectoryChain& chain,
  RenameWatcher& watcher,
  EntryWatcher* entryWatcher,
  const std::string& operation,
  const std::string& destinationPath
) {
  NativeResult result;
  AttachChainEvidence(chain, &result);
  int parent = chain.entries.back().descriptor.value;
  const std::string& leaf = request.relativeSegments.back();
  auto entryConflict = [&]() {
    NativeResult conflict;
    AttachChainEvidence(chain, &conflict);
    conflict.status = "conflict";
    struct stat current {};
    conflict.existingKind = fstatat(parent, leaf.c_str(), &current, AT_SYMLINK_NOFOLLOW) == 0
      ? (S_ISLNK(current.st_mode) ? "symlink" : "replaced")
      : "replaced";
    return conflict;
  };
  struct stat beforeOpen {};
  if (fstatat(parent, leaf.c_str(), &beforeOpen, AT_SYMLINK_NOFOLLOW) != 0) {
    if (errno == ENOENT) {
      result.status = "missing";
      result.existingKind = "missing";
      return result;
    }
    return Failure("inspection_failed", "DESTINATION_INSPECTION_FAILED", ErrnoMessage(errno));
  }
  if (!S_ISREG(beforeOpen.st_mode) || beforeOpen.st_nlink != 1) {
    result.status = "conflict";
    result.existingKind = ExistingKind(beforeOpen);
    return result;
  }
  UniqueFD file(openat(parent, leaf.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
  if (file.value < 0) {
    if (errno == ELOOP) {
      result.status = "conflict";
      result.existingKind = "symlink";
      return result;
    }
    return Failure("inspection_failed", "DESTINATION_OPEN_FAILED", ErrnoMessage(errno));
  }
  struct stat opened {};
  if (fstat(file.value, &opened) != 0) return Failure("inspection_failed", "DESTINATION_STAT_FAILED", ErrnoMessage(errno));
  if (!S_ISREG(opened.st_mode) || opened.st_nlink != 1 || !SameIdentity(beforeOpen, opened)) {
    result.status = "conflict";
    result.existingKind = opened.st_nlink != 1 ? "multiple_links" : "replaced";
    return result;
  }
  if (request.expectedIdentity.present
      && (request.expectedIdentity.device != static_cast<uint64_t>(opened.st_dev)
        || request.expectedIdentity.inode != static_cast<uint64_t>(opened.st_ino))) {
    result.status = "conflict";
    result.existingKind = "different_file";
    return result;
  }

  HookOutcome afterOpen = CallHook(env, request, operation, "after_leaf_open", destinationPath, "");
  int guardError = 0;
  if (afterOpen.callbackFailed || !GuardStable(chain, watcher, &guardError)) {
    return Failure("inspection_failed", "DIRECTORY_CHAIN_CHANGED", "Directory identity changed during descriptor-relative inspection.");
  }
  if (entryWatcher != nullptr && entryWatcher->Changed(&guardError)) return entryConflict();
  std::vector<uint8_t> bytes;
  int readError = 0;
  if (!ReadBoundedFile(file.value, opened, &bytes, &readError)) {
    return Failure("inspection_failed", readError == EFBIG ? "DESTINATION_TOO_LARGE" : "DESTINATION_READ_FAILED", ErrnoMessage(readError));
  }
  HookOutcome afterReadHook = CallHook(env, request, operation, "after_readback", destinationPath, "");
  if (afterReadHook.callbackFailed || !GuardStable(chain, watcher, &guardError)) {
    return Failure("inspection_failed", "DIRECTORY_CHAIN_CHANGED", "Directory identity changed during descriptor-relative inspection.");
  }
  if (entryWatcher != nullptr && entryWatcher->Changed(&guardError)) return entryConflict();
  struct stat afterRead {};
  struct stat atPath {};
  if (fstat(file.value, &afterRead) != 0
      || fstatat(parent, leaf.c_str(), &atPath, AT_SYMLINK_NOFOLLOW) != 0
      || !S_ISREG(atPath.st_mode)
      || atPath.st_nlink != 1
      || !SameSnapshot(opened, afterRead)
      || !SameIdentity(opened, atPath)) {
    result.status = "conflict";
    result.existingKind = S_ISLNK(atPath.st_mode) ? "symlink" : "replaced";
    return result;
  }
  if (entryWatcher != nullptr && entryWatcher->Changed(&guardError)) return entryConflict();
  result.identity = IdentityFromStat(opened);
  result.existingKind = "file";
  result.existingDigest = Sha256(bytes.data(), bytes.size());
  result.bytes = std::move(bytes);
  result.includeBytes = true;
  if (request.hasBytes) {
    bool identical = result.bytes.size() == request.byteCount
      && (request.byteCount == 0 || memcmp(result.bytes.data(), request.bytes, request.byteCount) == 0);
    result.status = identical ? "identical_existing" : "conflict";
  } else {
    result.status = "readable";
  }
  return result;
}

NativeResult Inspect(napi_env env, const ParsedRequest& request) {
  DirectoryChain chain;
  int chainError = 0;
  ChainStatus chainStatus = OpenDirectoryChain(request, false, &chain, &chainError);
  if (chainStatus == ChainStatus::kMissing) {
    NativeResult result;
    result.status = "missing";
    result.existingKind = "missing";
    return result;
  }
  if (chainStatus == ChainStatus::kInvalid) {
    return Failure("inspection_failed", "DIRECTORY_CHAIN_INVALID", "Boundary root or destination parent traverses a symlink or non-directory.");
  }
  if (chainStatus != ChainStatus::kOpened) {
    return Failure("inspection_failed", "DIRECTORY_CHAIN_OPEN_FAILED", ErrnoMessage(chainError));
  }
  RenameWatcher watcher;
  int watcherError = 0;
  if (!watcher.Start(chain, &watcherError)) {
    return Failure("inspection_failed", "DIRECTORY_WATCH_UNAVAILABLE", ErrnoMessage(watcherError));
  }
  EntryWatcher entryWatcher;
  if (!entryWatcher.Start(chain.entries.back().descriptor.value, &watcherError)) {
    return Failure("inspection_failed", "ENTRY_WATCH_UNAVAILABLE", ErrnoMessage(watcherError));
  }
  std::string destinationPath = JoinPath(request.rootPath, request.relativeSegments, request.relativeSegments.size());
  HookOutcome chainHook = CallHook(env, request, "inspect", "after_chain_opened", destinationPath, "");
  if (chainHook.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return Failure("inspection_failed", "DIRECTORY_CHAIN_CHANGED", "Directory identity changed during descriptor-relative inspection.");
  }
  return InspectWithChain(env, request, chain, watcher, &entryWatcher, "inspect", destinationPath);
}

bool WriteAll(int descriptor, const uint8_t* bytes, size_t count, int* errorNumber) {
  size_t offset = 0;
  while (offset < count) {
    ssize_t written = write(descriptor, bytes + offset, count - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) {
      *errorNumber = written == 0 ? EIO : errno;
      return false;
    }
    offset += static_cast<size_t>(written);
  }
  return true;
}

std::string RandomTempName() {
  std::array<uint8_t, 16> random {};
  arc4random_buf(random.data(), random.size());
  static constexpr char hex[] = "0123456789abcdef";
  std::string result = ".aos-work-record-";
  for (uint8_t byte : random) {
    result.push_back(hex[(byte >> 4U) & 0x0fU]);
    result.push_back(hex[byte & 0x0fU]);
  }
  result.append(".tmp");
  return result;
}

bool OwnedEntryPresent(int parent, const std::string& name, const struct stat& expected) {
  struct stat atPath {};
  return fstatat(parent, name.c_str(), &atPath, AT_SYMLINK_NOFOLLOW) == 0
    && S_ISREG(atPath.st_mode)
    && SameIdentity(atPath, expected);
}

bool StableLinkCount(
  int descriptor,
  uint64_t expectedLinks,
  const LinkWatcher& watcher,
  struct stat* observed,
  int* errorNumber
) {
  struct stat before {};
  struct stat after {};
  if (fstat(descriptor, &before) != 0) {
    *errorNumber = errno;
    return false;
  }
  *observed = before;
  if (watcher.Changed(errorNumber)) return false;
  if (fstat(descriptor, &after) != 0) {
    *errorNumber = errno;
    return false;
  }
  *observed = after;
  return S_ISREG(before.st_mode)
    && S_ISREG(after.st_mode)
    && SameIdentity(before, after)
    && static_cast<uint64_t>(before.st_nlink) == expectedLinks
    && static_cast<uint64_t>(after.st_nlink) == expectedLinks;
}

NativeResult RollbackContent(
  const NativeResult& evidence,
  int parent,
  const std::string& leaf,
  const std::string& tempName,
  int tempDescriptor,
  const struct stat& expected,
  const std::string& errorCode,
  const std::string& errorMessage,
  const std::string& existingKind = "",
  const std::string& failureStatus = "write_failed"
) {
  bool scrubbed = ftruncate(tempDescriptor, 0) == 0 && fsync(tempDescriptor) == 0;
  bool destinationLeftover = OwnedEntryPresent(parent, leaf, expected);
  bool tempLeftover = OwnedEntryPresent(parent, tempName, expected);
  NativeResult result = Failure(
    scrubbed ? failureStatus : "cleanup_failed",
    errorCode,
    errorMessage
  );
  result.tempFile = evidence.tempFile;
  result.tempFileLeftover = tempLeftover;
  result.destinationFileLeftover = destinationLeftover;
  result.contentScrubbed = scrubbed;
  result.existingKind = existingKind;
  result.rootIdentity = evidence.rootIdentity;
  result.directoryChain = evidence.directoryChain;
  if (result.status == "cleanup_failed") {
    result.cleanupErrorCode = "PUBLICATION_ROLLBACK_FAILED";
    result.cleanupErrorMessage = "Could not scrub invocation-owned staged content through its held descriptor.";
  }
  return result;
}

NativeResult RejectHardlinkLeak(
  const NativeResult& evidence,
  int parent,
  const std::string& leaf,
  const std::string& tempName,
  int tempDescriptor,
  const struct stat& expected
) {
  return RollbackContent(
    evidence,
    parent,
    leaf,
    tempName,
    tempDescriptor,
    expected,
    "EXTERNAL_HARDLINK_DETECTED",
    "Unexpected hard-link activity invalidated descriptor-relative publication.",
    "multiple_links"
  );
}

NativeResult RejectPublishedLinkChange(
  const NativeResult& evidence,
  int parent,
  const std::string& leaf,
  const std::string& tempName,
  int tempDescriptor,
  const struct stat& expected,
  const struct stat& observed,
  uint64_t expectedLinks
) {
  if (static_cast<uint64_t>(observed.st_nlink) >= expectedLinks) {
    return RejectHardlinkLeak(evidence, parent, leaf, tempName, tempDescriptor, expected);
  }
  return RollbackContent(
    evidence,
    parent,
    leaf,
    tempName,
    tempDescriptor,
    expected,
    "DESTINATION_IDENTITY_CHANGED",
    "Published destination link identity changed during descriptor-relative publication.",
    "replaced",
    "conflict"
  );
}

NativeResult Publish(napi_env env, const ParsedRequest& request) {
  DirectoryChain chain;
  int chainError = 0;
  ChainStatus chainStatus = OpenDirectoryChain(request, true, &chain, &chainError);
  if (chainStatus == ChainStatus::kInvalid) {
    return Failure("write_failed", "DIRECTORY_CHAIN_INVALID", "Boundary root or destination parent traverses a symlink or non-directory.");
  }
  if (chainStatus != ChainStatus::kOpened) {
    return Failure("write_failed", "DIRECTORY_CHAIN_OPEN_FAILED", ErrnoMessage(chainError));
  }
  RenameWatcher watcher;
  int watcherError = 0;
  if (!watcher.Start(chain, &watcherError)) {
    return Failure("write_failed", "DIRECTORY_WATCH_UNAVAILABLE", ErrnoMessage(watcherError));
  }
  const std::string destinationPath = JoinPath(request.rootPath, request.relativeSegments, request.relativeSegments.size());
  const std::string& leaf = request.relativeSegments.back();
  int parent = chain.entries.back().descriptor.value;

  HookOutcome chainHook = CallHook(env, request, "publish", "after_chain_opened", destinationPath, "");
  if (chainHook.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return Failure("write_failed", "DIRECTORY_CHAIN_CHANGED", "Directory identity changed before descriptor-relative publication.");
  }

  std::string tempName;
  UniqueFD temp;
  for (size_t attempt = 0; attempt < 8U; ++attempt) {
    tempName = RandomTempName();
    std::string tempPath = JoinPath(request.rootPath, request.relativeSegments, request.relativeSegments.size() - 1U) + "/" + tempName;
    HookOutcome beforeOpen = CallHook(env, request, "publish", "before_temp_open", destinationPath, tempPath);
    if (beforeOpen.callbackFailed || beforeOpen.failOperation == "open_temp") {
      return Failure("write_failed", "TEMP_OPEN_FAILED", "Injected temp creation failure.");
    }
    if (!GuardStable(chain, watcher, &watcherError)) {
      return Failure("write_failed", "DIRECTORY_CHAIN_CHANGED", "Directory identity changed before descriptor-relative temp creation.");
    }
    int descriptor = openat(parent, tempName.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (descriptor >= 0) {
      temp.reset(descriptor);
      break;
    }
    if (errno != EEXIST) return Failure("write_failed", "TEMP_OPEN_FAILED", ErrnoMessage(errno));
  }
  if (temp.value < 0) return Failure("write_failed", "TEMP_NAME_EXHAUSTED", "Could not allocate a unique content-free temp name.");

  NativeResult evidence;
  AttachChainEvidence(chain, &evidence);
  evidence.tempFile = JoinPath(request.rootPath, request.relativeSegments, request.relativeSegments.size() - 1U) + "/" + tempName;
  struct stat tempStat {};
  if (fstat(temp.value, &tempStat) != 0) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "TEMP_STAT_FAILED",
      ErrnoMessage(errno)
    );
  }

  LinkWatcher linkWatcher;
  int linkWatchError = 0;
  if (!linkWatcher.Start(temp.value, &linkWatchError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "HARDLINK_WATCH_UNAVAILABLE",
      ErrnoMessage(linkWatchError)
    );
  }
  HookOutcome afterOpen = CallHook(env, request, "publish", "after_temp_open", destinationPath, evidence.tempFile);
  if (afterOpen.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_CHAIN_CHANGED",
      "Directory identity changed after descriptor-relative temp creation."
    );
  }

  struct stat tempAtPath {};
  int tempGuardError = 0;
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &tempStat, &tempGuardError)) {
    return RejectHardlinkLeak(evidence, parent, leaf, tempName, temp.value, tempStat);
  }
  if (fstatat(parent, tempName.c_str(), &tempAtPath, AT_SYMLINK_NOFOLLOW) != 0
      || !SameIdentity(tempStat, tempAtPath)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "TEMP_IDENTITY_CHANGED",
      "Temp file identity changed before content write."
    );
  }

  int writeError = 0;
  if (!WriteAll(temp.value, request.bytes, request.byteCount, &writeError) || fsync(temp.value) != 0) {
    int saved = writeError == 0 ? errno : writeError;
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "TEMP_WRITE_FAILED",
      ErrnoMessage(saved)
    );
  }
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &tempStat, &tempGuardError)) {
    return RejectHardlinkLeak(evidence, parent, leaf, tempName, temp.value, tempStat);
  }
  if (fstatat(parent, tempName.c_str(), &tempAtPath, AT_SYMLINK_NOFOLLOW) != 0
      || !SameIdentity(tempStat, tempAtPath)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "TEMP_IDENTITY_CHANGED",
      "Temp file identity changed before publication."
    );
  }

  HookOutcome beforeLink = CallHook(env, request, "publish", "before_publish_link", destinationPath, evidence.tempFile);
  if (beforeLink.callbackFailed || beforeLink.failOperation == "link_destination") {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_LINK_FAILED",
      "Injected destination link failure."
    );
  }
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &tempStat, &tempGuardError)) {
    return RejectHardlinkLeak(evidence, parent, leaf, tempName, temp.value, tempStat);
  }
  if (fstatat(parent, tempName.c_str(), &tempAtPath, AT_SYMLINK_NOFOLLOW) != 0
      || !S_ISREG(tempAtPath.st_mode)
      || !SameIdentity(tempStat, tempAtPath)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "TEMP_IDENTITY_CHANGED",
      "Temp file identity changed immediately before publication."
    );
  }
  if (!GuardStable(chain, watcher, &watcherError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_CHAIN_CHANGED",
      "Directory identity changed before descriptor-relative publication."
    );
  }
  unsigned int renameFlags = RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH;
  if (renameatx_np(
        parent,
        tempName.c_str(),
        parent,
        leaf.c_str(),
        renameFlags
      ) != 0) {
    int renameError = errno;
    struct stat failedRenameStat {};
    if (!StableLinkCount(temp.value, 1U, linkWatcher, &failedRenameStat, &tempGuardError)) {
      return RejectHardlinkLeak(evidence, parent, leaf, tempName, temp.value, failedRenameStat);
    }
    NativeResult rollback = RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      renameError == EINVAL || renameError == ENOTSUP
        ? "DESCRIPTOR_RELATIVE_RENAME_UNSUPPORTED"
        : "DESTINATION_LINK_FAILED",
      ErrnoMessage(renameError)
    );
    if (!rollback.contentScrubbed) return rollback;
    if (renameError == EEXIST) {
      EntryWatcher entryWatcher;
      if (!entryWatcher.Start(parent, &tempGuardError)) {
        NativeResult result = rollback;
        result.status = "inspection_failed";
        result.errorCode = "ENTRY_WATCH_UNAVAILABLE";
        result.errorMessage = ErrnoMessage(tempGuardError);
        return result;
      }
      NativeResult result = InspectWithChain(env, request, chain, watcher, &entryWatcher, "publish", destinationPath);
      result.tempFile = evidence.tempFile;
      result.published = false;
      result.tempFileLeftover = rollback.tempFileLeftover;
      result.destinationFileLeftover = rollback.destinationFileLeftover;
      result.contentScrubbed = rollback.contentScrubbed;
      return result;
    }
    return rollback;
  }

  struct stat linkedTemp {};
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &linkedTemp, &tempGuardError)) {
    return RejectPublishedLinkChange(evidence, parent, leaf, tempName, temp.value, tempStat, linkedTemp, 1U);
  }
  EntryWatcher publishedEntryWatcher;
  if (!publishedEntryWatcher.Start(parent, &tempGuardError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "ENTRY_WATCH_UNAVAILABLE",
      ErrnoMessage(tempGuardError)
    );
  }

  HookOutcome afterLink = CallHook(env, request, "publish", "after_publish_link", destinationPath, evidence.tempFile);
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &linkedTemp, &tempGuardError)) {
    return RejectPublishedLinkChange(evidence, parent, leaf, tempName, temp.value, tempStat, linkedTemp, 1U);
  }
  if (afterLink.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_CHAIN_CHANGED",
      "Directory identity changed after descriptor-relative publication."
    );
  }
  if (publishedEntryWatcher.Changed(&tempGuardError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_IDENTITY_CHANGED",
      "Publication entries changed after descriptor-relative transfer.",
      "replaced",
      "conflict"
    );
  }

  struct stat destinationAtPath {};
  struct stat tempAfterRename {};
  errno = 0;
  bool tempNameAbsent = fstatat(parent, tempName.c_str(), &tempAfterRename, AT_SYMLINK_NOFOLLOW) != 0
    && errno == ENOENT;
  if (!tempNameAbsent
      || fstatat(parent, leaf.c_str(), &destinationAtPath, AT_SYMLINK_NOFOLLOW) != 0
      || !S_ISREG(destinationAtPath.st_mode)
      || !SameIdentity(linkedTemp, destinationAtPath)
      || linkedTemp.st_nlink != 1) {
    bool externalLinks = linkedTemp.st_nlink > 1;
    if (externalLinks) {
      return RejectHardlinkLeak(evidence, parent, leaf, tempName, temp.value, tempStat);
    }
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_IDENTITY_CHANGED",
      "Published destination did not retain the atomically transferred staged inode.",
      S_ISLNK(destinationAtPath.st_mode) ? "symlink" : "replaced",
      "conflict"
    );
  }

  if (fsync(parent) != 0) {
    int syncError = errno;
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_SYNC_FAILED",
      ErrnoMessage(syncError)
    );
  }

  HookOutcome beforeReadback = CallHook(env, request, "publish", "before_readback", destinationPath, evidence.tempFile);
  struct stat beforeRead {};
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &beforeRead, &tempGuardError)) {
    return RejectPublishedLinkChange(evidence, parent, leaf, tempName, temp.value, tempStat, beforeRead, 1U);
  }
  if (beforeReadback.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_CHAIN_CHANGED",
      "Directory identity changed before final descriptor-relative readback."
    );
  }
  if (publishedEntryWatcher.Changed(&tempGuardError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_IDENTITY_CHANGED",
      "Published entry changed before final descriptor-relative readback.",
      "replaced",
      "conflict"
    );
  }
  std::vector<uint8_t> readback;
  int readError = 0;
  if (!ReadBoundedFile(temp.value, beforeRead, &readback, &readError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_READBACK_FAILED",
      ErrnoMessage(readError)
    );
  }
  HookOutcome afterReadback = CallHook(env, request, "publish", "after_readback", destinationPath, evidence.tempFile);
  struct stat afterRead {};
  if (!StableLinkCount(temp.value, 1U, linkWatcher, &afterRead, &tempGuardError)) {
    return RejectPublishedLinkChange(evidence, parent, leaf, tempName, temp.value, tempStat, afterRead, 1U);
  }
  if (afterReadback.callbackFailed || !GuardStable(chain, watcher, &watcherError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DIRECTORY_CHAIN_CHANGED",
      "Directory identity changed after final descriptor-relative readback."
    );
  }
  if (publishedEntryWatcher.Changed(&tempGuardError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      "DESTINATION_IDENTITY_CHANGED",
      "Published entry changed during final descriptor-relative readback.",
      "replaced",
      "conflict"
    );
  }
  struct stat finalAtPath {};
  bool exactBytes = readback.size() == request.byteCount
    && (request.byteCount == 0 || memcmp(readback.data(), request.bytes, request.byteCount) == 0);
  if (fstatat(parent, leaf.c_str(), &finalAtPath, AT_SYMLINK_NOFOLLOW) != 0
      || !SameSnapshot(beforeRead, afterRead)
      || !SameIdentity(beforeRead, finalAtPath)
      || static_cast<uint64_t>(finalAtPath.st_nlink) != 1U
      || !exactBytes
      || publishedEntryWatcher.Changed(&tempGuardError)) {
    return RollbackContent(
      evidence,
      parent,
      leaf,
      tempName,
      temp.value,
      tempStat,
      exactBytes ? "DESTINATION_IDENTITY_CHANGED" : "CONTENT_MISMATCH",
      "Final descriptor-relative destination proof failed.",
      S_ISLNK(finalAtPath.st_mode) ? "symlink" : "replaced",
      "conflict"
    );
  }

  NativeResult result;
  result.status = "published";
  result.published = true;
  result.tempFileLeftover = false;
  result.tempFile = evidence.tempFile;
  result.existingKind = "file";
  result.existingDigest = Sha256(readback.data(), readback.size());
  result.identity = IdentityFromStat(afterRead);
  result.rootIdentity = evidence.rootIdentity;
  result.directoryChain = evidence.directoryChain;
  return result;
}

napi_value InspectBinding(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  ParsedRequest request;
  std::string parseError;
  if (argc != 1 || !ParseRequest(env, argv[0], false, &request, &parseError)) {
    return ResultValue(env, Failure("inspection_failed", "INVALID_ARGUMENT", parseError));
  }
  return ResultValue(env, Inspect(env, request));
}

napi_value PublishBinding(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  ParsedRequest request;
  std::string parseError;
  if (argc != 1 || !ParseRequest(env, argv[0], true, &request, &parseError)) {
    return ResultValue(env, Failure("write_failed", "INVALID_ARGUMENT", parseError));
  }
  return ResultValue(env, Publish(env, request));
}

napi_value CapabilitiesBinding(napi_env env, napi_callback_info) {
  napi_value object;
  napi_create_object(env, &object);
  SetNamedString(env, object, "schema_version", "aos.descriptor-relative-fs.v1");
  SetNamedString(env, object, "platform", "darwin");
  SetNamedBool(env, object, "descriptor_relative", true);
  SetNamedBool(env, object, "rename_detection", true);
  SetNamedBool(env, object, "hardlink_detection", true);
  SetNamedBool(env, object, "atomic_unique_link", true);
  SetNamedBool(env, object, "hardlink_scrubbing", true);
  return object;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"capabilities", nullptr, CapabilitiesBinding, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspect", nullptr, InspectBinding, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"publish", nullptr, PublishBinding, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
