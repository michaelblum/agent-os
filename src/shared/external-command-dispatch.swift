// external-command-dispatch.swift — Manifest-backed command launcher

import Darwin
import CoreFoundation
import CryptoKit
import Foundation
import Security

private let externalCommandManifestRelativePath = "manifests/commands/aos-external-commands.json"
private let externalDispatchBindingTokenEnvironmentKey = "AOS_EXTERNAL_DISPATCH_BINDING_TOKEN"
private let legacyExternalDispatchParentPIDEnvironmentKey = "AOS_EXTERNAL_DISPATCH_PARENT_PID"
private let externalDispatchLifecycleParentPIDEnvironmentKey = "AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID"
private let externalDispatchReviewedDependencySetDigestEnvironmentKey = "AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST"
private let trustedNodeDesignatedRequirement = "anchor apple generic and identifier \"node\" and certificate leaf[subject.OU] = \"HX7739G8FX\""
private let trustedNodeSigningIdentifier = "node"
private let trustedNodeSigningTeamIdentifier = "HX7739G8FX"
private let trustedNodePlatformCodeDirectoryHashAlgorithm = "sha256_truncated_cdhash_20_bytes"
private let reviewedExternalSpawnDependencyIdentities = [
    "scripts/lib/aos-daemon-client.mjs",
    "scripts/lib/aos-voice-follow.mjs",
]
private let reviewedExternalSpawnSourceMaxBytes = 128 * 1_024
private let reviewedExternalSpawnBundleMaxBytes = 512 * 1_024
private let registeredExternalSpawnInheritedEnvironmentKeys: Set<String> = [
    "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
    "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "PATH",
    "AOS_ALLOW_DAEMON_AUTOSTART", "AOS_DISABLE_DAEMON_AUTOSTART", "AOS_SESSION_ID",
]

private struct ExternalCommandManifest: Decodable {
    let generated: ExternalCommandManifestGeneration
    let schemaVersion: Int
    let commands: [ExternalCommand]

    enum CodingKeys: String, CodingKey {
        case generated
        case schemaVersion = "schema_version"
        case commands
    }
}

private struct ExternalCommandManifestGeneration: Decodable {
    let artifact: Bool
    let description: String
    let sourceOwner: String
    let sourcePath: String
    let regenerationCommand: String

    enum CodingKeys: String, CodingKey {
        case artifact
        case description
        case sourceOwner = "source_owner"
        case sourcePath = "source_path"
        case regenerationCommand = "regeneration_command"
    }
}

private struct ExternalCommand: Decodable {
    let path: [String]
    let summary: String
    let executable: String
    let argvPrefix: [String]
    let helpPassthrough: Bool?
    let cwd: String?
    let env: [String: String]?
    let stdio: ExternalCommandStdio?
    let when: ExternalCommandCondition?
    let spawnRegistration: ExternalCommandSpawnRegistration?

    enum CodingKeys: String, CodingKey {
        case path
        case summary
        case executable
        case argvPrefix = "argv_prefix"
        case helpPassthrough = "help_passthrough"
        case cwd
        case env
        case stdio
        case when
        case spawnRegistration = "spawn_registration"
    }
}

private struct ExternalCommandSpawnRegistration: Decodable {
    let routeSourceID: String
    let routeSourceRevision: String
    let adapterRegistrationID: String
    let adapterRegistrationRevision: Int
    let activationPredicate: ExternalCommandSpawnActivationPredicate
    let executableResolutionPolicy: ExternalCommandExecutableResolutionPolicy
    let expectedScriptIdentity: String
    let expectedScriptDigest: String
    let reviewedDependencies: [ExternalCommandReviewedDependency]
    let reviewedDependencySetDigest: String
    let canonicalArgvShapeDigest: String

    enum CodingKeys: String, CodingKey {
        case routeSourceID = "route_source_id"
        case routeSourceRevision = "route_source_revision"
        case adapterRegistrationID = "adapter_registration_id"
        case adapterRegistrationRevision = "adapter_registration_revision"
        case activationPredicate = "activation_predicate"
        case executableResolutionPolicy = "executable_resolution_policy"
        case expectedScriptIdentity = "expected_script_identity"
        case expectedScriptDigest = "expected_script_digest"
        case reviewedDependencies = "reviewed_dependencies"
        case reviewedDependencySetDigest = "reviewed_dependency_set_digest"
        case canonicalArgvShapeDigest = "canonical_argv_shape_digest"
    }
}

private struct ExternalCommandSpawnActivationPredicate: Decodable {
    let grammar: String
}

private struct ExternalCommandReviewedDependency: Decodable {
    let identity: String
    let digest: String
}

private struct ExternalCommandExecutableResolutionPolicy: Decodable {
    let launcherShape: String
    let resolutionOwner: String
    let resolutionPhase: String
    let searchSource: String
    let commandName: String
    let designatedRequirement: String
    let signingIdentifier: String
    let signingTeamIdentifier: String
    let requiresHardenedRuntime: Bool
    let platformCodeDirectoryHashAlgorithm: String
    let reviewedSourceMaxBytes: Int
    let reviewedBundleMaxBytes: Int

    enum CodingKeys: String, CodingKey {
        case launcherShape = "launcher_shape"
        case resolutionOwner = "resolution_owner"
        case resolutionPhase = "resolution_phase"
        case searchSource = "search_source"
        case commandName = "command_name"
        case designatedRequirement = "designated_requirement"
        case signingIdentifier = "signing_identifier"
        case signingTeamIdentifier = "signing_team_identifier"
        case requiresHardenedRuntime = "requires_hardened_runtime"
        case platformCodeDirectoryHashAlgorithm = "platform_code_directory_hash_algorithm"
        case reviewedSourceMaxBytes = "reviewed_source_max_bytes"
        case reviewedBundleMaxBytes = "reviewed_bundle_max_bytes"
    }
}

private struct ExternalCommandCondition: Decodable {
    let childArgIndex: Int?
    let childArgMissing: Bool?
    let prefix: String?
    let excludedPrefixes: [String]?
    let excludedValues: [String]?

    enum CodingKeys: String, CodingKey {
        case childArgIndex = "child_arg_index"
        case childArgMissing = "child_arg_missing"
        case prefix
        case excludedPrefixes = "excluded_prefixes"
        case excludedValues = "excluded_values"
    }
}

private enum ExternalCommandStdio: String, Decodable {
    case capture
    case inherit
    case registeredBundle = "registered_bundle"
}

private func externalManifestObject(
    _ value: Any?,
    required: Set<String>,
    optional: Set<String> = []
) -> [String: Any]? {
    guard let object = value as? [String: Any] else { return nil }
    let keys = Set(object.keys)
    guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else { return nil }
    return object
}

private func registeredSpawnEnvironmentKeyIsUnsafe(_ key: String) -> Bool {
    key == "NODE"
        || key.hasPrefix("NODE_")
        || key.hasPrefix("DYLD_")
        || key.hasPrefix("LD_")
        || key == "BASH_ENV"
        || key == "ENV"
}

private func externalManifestInteger(
    _ value: Any?,
    minimum: Int,
    maximum: Int = Int.max
) -> Int? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite,
          number.doubleValue.rounded() == number.doubleValue else {
        return nil
    }
    let integer = number.intValue
    return integer >= minimum && integer <= maximum ? integer : nil
}

private func externalManifestNonemptyString(_ value: Any?) -> String? {
    guard let string = value as? String, !string.isEmpty else { return nil }
    return string
}

private func externalOperationIdentifier(_ value: Any?) -> String? {
    guard let identifier = value as? String,
          identifier.count >= 1,
          identifier.count <= 128,
          identifier.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            options: .regularExpression
          ) != nil else {
        return nil
    }
    return identifier
}

private func externalManifestStringArray(
    _ value: Any?,
    pattern: String? = nil,
    unique: Bool = false
) -> [String]? {
    guard let values = value as? [Any], !values.isEmpty else { return nil }
    var strings: [String] = []
    for value in values {
        guard let string = externalManifestNonemptyString(value) else { return nil }
        if let pattern,
           string.range(of: pattern, options: .regularExpression) == nil {
            return nil
        }
        strings.append(string)
    }
    if unique && Set(strings).count != strings.count { return nil }
    return strings
}

private func validateExternalCommandManifestWireV2(_ data: Data) -> Bool {
    guard let raw = try? JSONSerialization.jsonObject(with: data),
          let manifest = externalManifestObject(
            raw,
            required: ["generated", "schema_version", "commands"],
            optional: ["$schema"]
          ),
          externalManifestInteger(manifest["schema_version"], minimum: 2) == 2,
          manifest["$schema"] == nil || manifest["$schema"] is String,
          let generated = externalManifestObject(
            manifest["generated"],
            required: ["artifact", "description", "source_owner", "source_path", "regeneration_command"]
          ),
          generated["artifact"] as? Bool == true,
          generated["description"] as? String == "Generated command manifest. Edit source fragments, not this file.",
          generated["source_owner"] as? String == "manifests/AGENTS.md",
          generated["source_path"] as? String == "manifests/commands/source/external/",
          generated["regeneration_command"] as? String == "node scripts/generate-command-manifests.mjs",
          let commands = manifest["commands"] as? [Any],
          !commands.isEmpty else {
        return false
    }

    let commandRequired: Set<String> = ["path", "summary", "executable", "argv_prefix"]
    let commandOptional: Set<String> = [
        "help_passthrough", "cwd", "env", "stdio", "when", "spawn_registration",
    ]
    let conditionKeys: Set<String> = [
        "child_arg_index", "child_arg_missing", "prefix", "excluded_prefixes", "excluded_values",
    ]
    let registrationKeys: Set<String> = [
        "route_source_id", "route_source_revision", "adapter_registration_id",
        "adapter_registration_revision", "activation_predicate", "executable_resolution_policy", "expected_script_identity",
        "expected_script_digest", "reviewed_dependencies", "reviewed_dependency_set_digest",
        "canonical_argv_shape_digest",
    ]
    let policyKeys: Set<String> = [
        "launcher_shape", "resolution_owner", "resolution_phase", "search_source", "command_name",
        "designated_requirement", "signing_identifier", "signing_team_identifier",
        "requires_hardened_runtime", "platform_code_directory_hash_algorithm",
        "reviewed_source_max_bytes", "reviewed_bundle_max_bytes",
    ]
    var registeredCount = 0

    for rawCommand in commands {
        guard let command = externalManifestObject(
            rawCommand,
            required: commandRequired,
            optional: commandOptional
        ),
        let path = externalManifestStringArray(
            command["path"],
            pattern: "^[A-Za-z0-9_.-]+$"
        ),
        externalManifestNonemptyString(command["summary"]) != nil,
        let executable = command["executable"] as? String,
        ["$AOS_PATH", "/usr/bin/env", "/bin/bash"].contains(executable),
        let argvPrefix = externalManifestStringArray(command["argv_prefix"]) else {
            return false
        }
        if let helpPassthrough = command["help_passthrough"], !(helpPassthrough is Bool) {
            return false
        }
        if let cwd = command["cwd"] as? String,
           cwd != "repo" && cwd != "$AOS_REPO_ROOT" {
            return false
        } else if command["cwd"] != nil && !(command["cwd"] is String) {
            return false
        }
        if let stdio = command["stdio"] as? String,
           stdio != "capture" && stdio != "inherit" && stdio != "registered_bundle" {
            return false
        } else if command["stdio"] != nil && !(command["stdio"] is String) {
            return false
        }
        if let rawEnvironment = command["env"] {
            guard let environment = rawEnvironment as? [String: Any] else { return false }
            for (key, value) in environment {
                guard key.range(of: "^[A-Z_][A-Z0-9_]*$", options: .regularExpression) != nil,
                      key != externalDispatchBindingTokenEnvironmentKey,
                      key != legacyExternalDispatchParentPIDEnvironmentKey,
                      key != externalDispatchLifecycleParentPIDEnvironmentKey,
                      key != externalDispatchReviewedDependencySetDigestEnvironmentKey,
                      externalManifestNonemptyString(value) != nil else {
                    return false
                }
            }
        }
        if let rawCondition = command["when"] {
            guard let condition = externalManifestObject(
                rawCondition,
                required: ["child_arg_index"],
                optional: conditionKeys.subtracting(["child_arg_index"])
            ),
            externalManifestInteger(condition["child_arg_index"], minimum: 0) != nil else {
                return false
            }
            if let missing = condition["child_arg_missing"], !(missing is Bool) { return false }
            if let prefix = condition["prefix"], externalManifestNonemptyString(prefix) == nil { return false }
            for key in ["excluded_prefixes", "excluded_values"] where condition[key] != nil {
                guard externalManifestStringArray(condition[key], unique: true) != nil else { return false }
            }
        }
        if command["spawn_registration"] == nil,
           command["stdio"] as? String == "registered_bundle" {
            return false
        }
        guard let registrationValue = command["spawn_registration"] else { continue }
        registeredCount += 1
        guard registeredCount <= 1,
              let registration = externalManifestObject(registrationValue, required: registrationKeys),
              let policy = externalManifestObject(
                registration["executable_resolution_policy"],
                required: policyKeys
              ),
              policy["launcher_shape"] as? String == "usr_bin_env_node",
              policy["resolution_owner"] as? String == "native_external_dispatch",
              policy["resolution_phase"] as? String == "immediately_before_spawn",
              policy["search_source"] as? String == "sanitized_path",
              policy["command_name"] as? String == "node",
              policy["designated_requirement"] as? String == trustedNodeDesignatedRequirement,
              policy["signing_identifier"] as? String == trustedNodeSigningIdentifier,
              policy["signing_team_identifier"] as? String == trustedNodeSigningTeamIdentifier,
              policy["requires_hardened_runtime"] as? Bool == true,
              policy["platform_code_directory_hash_algorithm"] as? String
                == trustedNodePlatformCodeDirectoryHashAlgorithm,
              externalManifestInteger(policy["reviewed_source_max_bytes"], minimum: 1)
                == reviewedExternalSpawnSourceMaxBytes,
              externalManifestInteger(policy["reviewed_bundle_max_bytes"], minimum: 1)
                == reviewedExternalSpawnBundleMaxBytes,
              path == ["listen"],
              executable == "/usr/bin/env",
              argvPrefix == ["node", "--input-type=module", "-", "listen"],
              command["cwd"] as? String == "repo",
              command["stdio"] as? String == "registered_bundle",
              command["help_passthrough"] as? Bool != true,
              registration["route_source_id"] as? String == "listen",
              let routeRevision = registration["route_source_revision"] as? String,
              isLowercaseSHA256(routeRevision),
              registration["adapter_registration_id"] as? String == "microphone-capture-adapter",
              externalManifestInteger(registration["adapter_registration_revision"], minimum: 1) != nil,
              let activationPredicate = externalManifestObject(
                registration["activation_predicate"],
                required: ["grammar"]
              ),
              activationPredicate["grammar"] as? String == "listen_microphone_v1",
              registration["expected_script_identity"] as? String == "scripts/aos-tell-listen.mjs",
              let expectedScriptDigest = registration["expected_script_digest"] as? String,
              isLowercaseSHA256(expectedScriptDigest),
              let reviewedSetDigest = registration["reviewed_dependency_set_digest"] as? String,
              isLowercaseSHA256(reviewedSetDigest),
              let argvShapeDigest = registration["canonical_argv_shape_digest"] as? String,
              isLowercaseSHA256(argvShapeDigest),
              canonicalArgvShapeDigest(argvPrefix) == argvShapeDigest,
              let dependencies = registration["reviewed_dependencies"] as? [Any],
              dependencies.count == reviewedExternalSpawnDependencyIdentities.count else {
            return false
        }
        guard let environment = command["env"] as? [String: String],
              environment == [
                "AOS_PATH": "$AOS_PATH",
                "AOS_RUNTIME_MODE": "$AOS_RUNTIME_MODE",
                "AOS_STATE_ROOT": "$AOS_STATE_ROOT",
              ],
              !environment.keys.contains(where: registeredSpawnEnvironmentKeyIsUnsafe) else {
            return false
        }
        for (index, rawDependency) in dependencies.enumerated() {
            guard let dependency = externalManifestObject(rawDependency, required: ["identity", "digest"]),
                  dependency["identity"] as? String == reviewedExternalSpawnDependencyIdentities[index],
                  let digest = dependency["digest"] as? String,
                  isLowercaseSHA256(digest) else {
                return false
            }
        }
        guard let canonicalDependencyBytes = try? JSONSerialization.data(
            withJSONObject: dependencies,
            options: [.sortedKeys, .withoutEscapingSlashes]
        ),
        sha256Hex(canonicalDependencyBytes) == reviewedSetDigest else {
            return false
        }
    }
    return registeredCount == 1
}

func runExternalCommandIfMatched(args: [String]) -> Bool {
    if args.contains("--help") || args.contains("-h") {
        return false
    }
    guard let aosRepoRoot = aosCurrentRepoRoot() else {
        return false
    }
    let manifestPath = (aosRepoRoot as NSString).appendingPathComponent(externalCommandManifestRelativePath)
    guard FileManager.default.fileExists(atPath: manifestPath),
          let data = try? Data(contentsOf: URL(fileURLWithPath: manifestPath)) else {
        return false
    }

    guard validateExternalCommandManifestWireV2(data) else {
        exitError("Invalid external command manifest \(manifestPath): closed wire v2 validation failed", code: "INVALID_MANIFEST")
    }
    let manifest: ExternalCommandManifest
    do {
        manifest = try JSONDecoder().decode(ExternalCommandManifest.self, from: data)
    } catch {
        exitError("Invalid external command manifest \(manifestPath): \(error)", code: "INVALID_MANIFEST")
    }
    guard manifest.schemaVersion == 2 else {
        exitError("Unsupported external command manifest schema_version \(manifest.schemaVersion)", code: "INVALID_MANIFEST")
    }
    guard let command = manifest.commands
        .filter({ externalCommandMatches($0, args: args) })
        .max(by: { $0.path.count < $1.path.count }) else {
        return false
    }
    guard command.env?[externalDispatchBindingTokenEnvironmentKey] == nil,
          command.env?[legacyExternalDispatchParentPIDEnvironmentKey] == nil else {
        exitError("External command manifest authors reserved dispatch authority.", code: "INVALID_MANIFEST")
    }

    let repoOverride = rawOptionValue(args, "--repo")
    let commandRepoRoot = resolveExternalRepoRoot(repoOverride)
    let executable = resolveExternalExecutable(
        command.executable,
        repoRoot: commandRepoRoot,
        aosRepoRoot: aosRepoRoot
    )
    let childArgs = Array(args.dropFirst(command.path.count))
    let argv = command.argvPrefix.map {
        resolveExternalArg($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot)
    } + childArgs
    let cwd = command.cwd == "repo"
        ? commandRepoRoot
        : command.cwd.map { resolveExternalArg($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot) }
    let environment = command.env.map {
        resolveExternalEnvironment($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot)
    }
    if let registration = command.spawnRegistration {
        let registered = resolveRegisteredExternalSpawn(
            command: command,
            registration: registration,
            resolvedArgv: argv,
            forwardedArguments: childArgs,
            aosRepoRoot: aosRepoRoot
        )
        exit(runRegisteredExternalProcess(
            registered,
            cwd: cwd,
            environment: registeredExternalSpawnEnvironment(authored: environment ?? [:])
        ))
    }
    if command.stdio == .inherit {
        exit(runExternalProcessInheritingStdio(
            executable,
            arguments: argv,
            cwd: cwd,
            environment: environment
        ))
    }
    let result = runExternalProcessCapturingOutput(
        executable,
        arguments: argv,
        cwd: cwd,
        environment: environment
    )
    if !result.stdout.isEmpty, let data = result.stdout.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(result.exitCode)
}

private struct ResolvedRegisteredExternalSpawn {
    let executable: String
    let arguments: [String]
    let launchBundle: Data
    let bindingToken: String?
    let expectedPlatformCodeDirectoryHash: String
}

private struct ExternalExecutableEvidence {
    let resolvedPathDigest: String
    let executableIdentityDigest: String
    let device: UInt64
    let inode: UInt64
    let codeIdentityDigest: String
    let platformCodeDirectoryHash: String
    let signingIdentifier: String
    let signingTeamIdentifier: String
    let fileDigest: String
}

private struct ExternalNodeCodeSigningEvidence {
    let platformCodeDirectoryHash: String
    let signingIdentifier: String
    let signingTeamIdentifier: String
}

private func resolveRegisteredExternalSpawn(
    command: ExternalCommand,
    registration: ExternalCommandSpawnRegistration,
    resolvedArgv: [String],
    forwardedArguments: [String],
    aosRepoRoot: String
) -> ResolvedRegisteredExternalSpawn {
    let policy = registration.executableResolutionPolicy
    guard command.path == ["listen"],
          command.executable == "/usr/bin/env",
          command.argvPrefix == ["node", "--input-type=module", "-", "listen"],
          command.cwd == "repo",
          command.stdio == .registeredBundle,
          command.helpPassthrough != true,
          registration.expectedScriptIdentity == "scripts/aos-tell-listen.mjs",
          policy.launcherShape == "usr_bin_env_node",
          policy.resolutionOwner == "native_external_dispatch",
          policy.resolutionPhase == "immediately_before_spawn",
          policy.searchSource == "sanitized_path",
          policy.commandName == "node",
          policy.designatedRequirement == trustedNodeDesignatedRequirement,
          policy.signingIdentifier == trustedNodeSigningIdentifier,
          policy.signingTeamIdentifier == trustedNodeSigningTeamIdentifier,
          policy.requiresHardenedRuntime,
          policy.platformCodeDirectoryHashAlgorithm == trustedNodePlatformCodeDirectoryHashAlgorithm,
          policy.reviewedSourceMaxBytes == reviewedExternalSpawnSourceMaxBytes,
          policy.reviewedBundleMaxBytes == reviewedExternalSpawnBundleMaxBytes,
          registration.adapterRegistrationRevision > 0,
          registration.activationPredicate.grammar == "listen_microphone_v1",
          isLowercaseSHA256(registration.routeSourceRevision),
          isLowercaseSHA256(registration.expectedScriptDigest),
          isLowercaseSHA256(registration.reviewedDependencySetDigest),
          isLowercaseSHA256(registration.canonicalArgvShapeDigest),
          isNormalizedRepoRelativeIdentity(registration.expectedScriptIdentity) else {
        exitError("Invalid external spawn registration for \(command.path.joined(separator: " "))", code: "INVALID_MANIFEST")
    }

    let canonicalAOSRepoRoot = URL(fileURLWithPath: aosRepoRoot, isDirectory: true)
        .resolvingSymlinksInPath()
        .standardizedFileURL
    guard let (_, scriptBytes) = canonicalRegularFile(
            root: canonicalAOSRepoRoot,
            identity: registration.expectedScriptIdentity
          ),
          sha256Hex(scriptBytes) == registration.expectedScriptDigest,
          let reviewedDependencyBytes = reviewedDependencyEvidence(
            registration.reviewedDependencies,
            expectedSetDigest: registration.reviewedDependencySetDigest,
            root: canonicalAOSRepoRoot
          ),
          canonicalArgvShapeDigest(command.argvPrefix) == registration.canonicalArgvShapeDigest,
          let resolvedNode = resolveNodeFromSanitizedPath(),
          let executableEvidence = observeExternalExecutable(resolvedNode),
          let launchBundle = makeRegisteredExternalLaunchBundle(
            entryBytes: scriptBytes,
            dependencyBytes: reviewedDependencyBytes,
            reviewedDependencySetDigest: registration.reviewedDependencySetDigest,
            lifecycleParentPID: ProcessInfo.processInfo.processIdentifier
          ) else {
        exitError("External spawn registration evidence did not match for \(command.path.joined(separator: " "))", code: "INVALID_MANIFEST")
    }
    let bindingToken: String?
    let microphoneRequested = externalSpawnFlagValue(
        forwardedArguments,
        "--source"
    ) == "microphone"
    let hasAttributionFlags = externalSpawnAttributionFields.contains {
        forwardedArguments.contains($0.flag)
    }
    if microphoneRequested {
        guard externalCommandActivatesSpawnRegistration(forwardedArguments) else {
            exitError(
                "Invalid registered microphone invocation.",
                code: "INVALID_ARG"
            )
        }
        let assertedAttribution = externalSpawnAssertedAttribution(forwardedArguments)
        bindingToken = prepareExternalSpawnIntent(
            registration: registration,
            executable: executableEvidence,
            assertedAttribution: assertedAttribution
        )
    } else {
        guard !hasAttributionFlags else {
            exitError(
                "Asserted attribution is available only for microphone capture.",
                code: "INVALID_ARG"
            )
        }
        bindingToken = nil
    }
    let registeredArguments = Array(resolvedArgv.dropFirst())
    return ResolvedRegisteredExternalSpawn(
        executable: resolvedNode,
        arguments: registeredArguments,
        launchBundle: launchBundle,
        bindingToken: bindingToken,
        expectedPlatformCodeDirectoryHash: executableEvidence.platformCodeDirectoryHash
    )
}

private func externalSpawnFlagValue(_ arguments: [String], _ flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
        return nil
    }
    let value = arguments[index + 1]
    return !value.isEmpty && !value.hasPrefix("--") ? value : nil
}

private let externalSpawnAttributionFields: [(flag: String, wire: String)] = [
    ("--client-id", "client_id"),
    ("--agent-id", "agent_id"),
    ("--project-id", "project_id"),
    ("--task-id", "task_id"),
    ("--run-id", "run_id"),
    ("--skill-id", "skill_id"),
    ("--target-id", "target_id"),
    ("--capability-label", "capability_label"),
    ("--retry-id", "retry_id"),
]

private func externalSpawnAssertedAttribution(
    _ arguments: [String]
) -> [String: String] {
    var result: [String: String] = [:]
    for field in externalSpawnAttributionFields {
        let indexes = arguments.indices.filter { arguments[$0] == field.flag }
        guard indexes.count <= 1 else {
            exitError("Duplicate asserted attribution flag.", code: "INVALID_ARG")
        }
        guard let index = indexes.first else { continue }
        guard index + 1 < arguments.count,
              let value = externalOperationIdentifier(arguments[index + 1]) else {
            exitError("Invalid asserted attribution value.", code: "INVALID_ARG")
        }
        result[field.wire] = value
    }
    return result
}

private func externalSpawnDurationSeconds(
    _ value: String,
    allowedSuffixes: Set<String>
) -> Double? {
    guard value.range(
        of: "^\\d+(?:\\.\\d+)?(?:ms|s|m)?$",
        options: .regularExpression
    ) != nil else { return nil }
    let suffix = value.hasSuffix("ms") ? "ms"
        : value.hasSuffix("s") ? "s"
        : value.hasSuffix("m") ? "m" : ""
    guard allowedSuffixes.contains(suffix) else { return nil }
    let numeric = suffix.isEmpty ? value : String(value.dropLast(suffix.count))
    guard let amount = Double(numeric), amount.isFinite else { return nil }
    if suffix == "ms" { return amount / 1_000 }
    if suffix == "m" { return amount * 60 }
    return amount
}

private func externalCommandActivatesSpawnRegistration(_ arguments: [String]) -> Bool {
    let attributionFlags = Set(externalSpawnAttributionFields.map { $0.flag })
    let valueFlags: Set<String> = Set([
        "--source", "--shortcut", "--output", "--segments", "--segment-duration",
        "--max-duration", "--ready-cue",
    ]).union(attributionFlags)
    var seenValueFlags: Set<String> = []
    var index = 0
    while index < arguments.count {
        let argument = arguments[index]
        if argument == "--follow" {
            index += 1
            continue
        }
        guard valueFlags.contains(argument),
              seenValueFlags.insert(argument).inserted,
              index + 1 < arguments.count,
              !arguments[index + 1].isEmpty,
              !arguments[index + 1].hasPrefix("--") else {
            return false
        }
        if attributionFlags.contains(argument),
           externalOperationIdentifier(arguments[index + 1]) == nil {
            return false
        }
        index += 2
    }
    guard arguments.contains("--follow"),
          externalSpawnFlagValue(arguments, "--source") == "microphone",
          !arguments.contains("--shortcut") else {
        return false
    }
    let hasOutput = arguments.contains("--output")
    let hasSegments = arguments.contains("--segments")
    guard hasOutput != hasSegments else { return false }
    if hasOutput && (
        arguments.contains("--segment-duration") || arguments.contains("--ready-cue")
    ) {
        return false
    }
    if let maxDuration = externalSpawnFlagValue(arguments, "--max-duration") {
        guard let seconds = externalSpawnDurationSeconds(
            maxDuration,
            allowedSuffixes: ["", "ms", "s", "m"]
        ), seconds >= 0.001, seconds <= 120 else {
            return false
        }
    }
    if let segmentDuration = externalSpawnFlagValue(arguments, "--segment-duration") {
        guard let seconds = externalSpawnDurationSeconds(
            segmentDuration,
            allowedSuffixes: ["", "ms", "s"]
        ), seconds >= 0.5, seconds <= 5 else {
            return false
        }
    }
    if let cue = externalSpawnFlagValue(arguments, "--ready-cue"),
       cue != "none" && cue != "chime" {
        return false
    }
    return true
}

private func observeExternalExecutable(_ executable: String) -> ExternalExecutableEvidence? {
    var fileStat = stat()
    guard lstat(executable, &fileStat) == 0,
          (fileStat.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
          let bytes = try? Data(contentsOf: URL(fileURLWithPath: executable)),
          let signingEvidence = staticTrustedNodeCodeSigningEvidence(executable) else {
        return nil
    }
    let resolvedPathDigest = sha256Hex(Data(executable.utf8))
    let fileDigest = sha256Hex(bytes)
    let codeIdentityDigest = domainSeparatedSHA256(
        domain: "aos.operation.executable-code-identity.v1",
        data: Data(fileDigest.utf8)
    )
    let identity = [
        String(UInt64(fileStat.st_dev)),
        String(UInt64(fileStat.st_ino)),
        codeIdentityDigest,
        fileDigest,
    ].joined(separator: "\u{1f}")
    return ExternalExecutableEvidence(
        resolvedPathDigest: resolvedPathDigest,
        executableIdentityDigest: domainSeparatedSHA256(
            domain: "aos.operation.executable-identity.v1",
            data: Data(identity.utf8)
        ),
        device: UInt64(fileStat.st_dev),
        inode: UInt64(fileStat.st_ino),
        codeIdentityDigest: codeIdentityDigest,
        platformCodeDirectoryHash: signingEvidence.platformCodeDirectoryHash,
        signingIdentifier: signingEvidence.signingIdentifier,
        signingTeamIdentifier: signingEvidence.signingTeamIdentifier,
        fileDigest: fileDigest
    )
}

private func staticTrustedNodeCodeSigningEvidence(
    _ executable: String
) -> ExternalNodeCodeSigningEvidence? {
    var code: SecStaticCode?
    var requirement: SecRequirement?
    guard SecStaticCodeCreateWithPath(
            URL(fileURLWithPath: executable) as CFURL,
            [],
            &code
          ) == errSecSuccess,
          let code,
          SecRequirementCreateWithString(
            trustedNodeDesignatedRequirement as CFString,
            [],
            &requirement
          ) == errSecSuccess,
          let requirement,
          SecStaticCodeCheckValidity(
            code,
            SecCSFlags(rawValue: kSecCSStrictValidate),
            requirement
          )
            == errSecSuccess else {
        return nil
    }
    var rawInformation: CFDictionary?
    guard SecCodeCopySigningInformation(
            code,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &rawInformation
          ) == errSecSuccess,
          let rawInformation else {
        return nil
    }
    let information = rawInformation as NSDictionary
    guard let algorithms = information[kSecCodeInfoDigestAlgorithms as String]
            as? [NSNumber],
          let hashes = information[kSecCodeInfoCdHashes as String] as? [Data],
          algorithms.count == hashes.count,
          let sha256Index = algorithms.firstIndex(where: { $0.intValue == 2 }),
          hashes[sha256Index].count == 20,
          information[kSecCodeInfoIdentifier as String] as? String == trustedNodeSigningIdentifier,
          information[kSecCodeInfoTeamIdentifier as String] as? String == trustedNodeSigningTeamIdentifier,
          let flags = information[kSecCodeInfoFlags as String] as? NSNumber,
          flags.uint32Value & 0x0001_0000 != 0 else {
        return nil
    }
    return ExternalNodeCodeSigningEvidence(
        platformCodeDirectoryHash: hashes[sha256Index]
            .map { String(format: "%02x", $0) }
            .joined(),
        signingIdentifier: trustedNodeSigningIdentifier,
        signingTeamIdentifier: trustedNodeSigningTeamIdentifier
    )
}

private struct ExternalSpawnIntentFailureClassification: Equatable {
    let code: String
    let reason: String?

    static let safeDaemonCodes: Set<String> = [
        "OPERATION_ADAPTER_REGISTRY_CONFLICT",
        "OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE",
        "OPERATION_ARTIFACT_DESTINATION_EXISTS",
        "OPERATION_ARTIFACT_IDENTITY_MISMATCH",
        "OPERATION_ARTIFACT_RETAIN_UNAVAILABLE",
        "OPERATION_BARRIER_CLOSED",
        "OPERATION_BARRIER_GENERATION_CONFLICT",
        "OPERATION_BARRIER_NOT_CLOSED",
        "OPERATION_CALLER_NOT_AUTHENTICATED",
        "OPERATION_CONTROL_ORIGIN_UNSUPPORTED",
        "OPERATION_GENERATION_CONFLICT",
        "OPERATION_IDEMPOTENCY_CONFLICT",
        "OPERATION_NOT_FOUND",
        "OPERATION_OWNER_MISMATCH",
        "OPERATION_RECONCILIATION_INCOMPLETE",
        "OPERATION_RECORD_INVALID",
        "OPERATION_RECOVERY_CLAIM_STALE",
        "OPERATION_RESIDUALS_PRESENT",
        "OPERATION_RESOURCE_BUSY",
        "OPERATION_RESOURCE_CAS_CONFLICT",
        "OPERATION_RESOURCE_DECLARATION_CONFLICT",
        "OPERATION_RESOURCE_FANOUT_EXHAUSTED",
        "OPERATION_SPAWN_RECORD_CAPACITY",
        "OPERATION_STORE_CORRUPT",
        "OPERATION_STORE_LOCKED",
        "OPERATION_STORE_UNAVAILABLE",
        "OPERATION_TAP_UNAVAILABLE",
        "OPERATION_TRANSITION_INVALID",
    ]

    static let noResponse = ExternalSpawnIntentFailureClassification(
        code: "EXTERNAL_SPAWN_INTENT_NO_RESPONSE",
        reason: nil
    )
}

private func externalSpawnIntentDaemonFailureClassification(
    _ response: [String: Any]
) -> ExternalSpawnIntentFailureClassification? {
    guard response["error"] != nil else { return nil }
    let safeCode = (response["code"] as? String).flatMap {
        ExternalSpawnIntentFailureClassification.safeDaemonCodes.contains($0) ? $0 : nil
    } ?? "EXTERNAL_SPAWN_INTENT_DAEMON_ERROR"
    let reason = safeCode == "OPERATION_RECORD_INVALID"
        && (response["error"] as? String) == "OPERATION_RECORD_INVALID:external_spawn_intent"
        ? "external_spawn_intent"
        : nil
    return ExternalSpawnIntentFailureClassification(code: safeCode, reason: reason)
}

private func exitExternalSpawnIntentFailure(
    _ failure: ExternalSpawnIntentFailureClassification
) -> Never {
    let message = failure.code == ExternalSpawnIntentFailureClassification.noResponse.code
        ? "The external-spawn intent response was unavailable."
        : "The external-spawn intent was rejected."
    let details: [String: Any] = failure.reason.map { ["reason": $0] } ?? [:]
    exitError(message, code: failure.code, details: details)
}

private func prepareExternalSpawnIntent(
    registration: ExternalCommandSpawnRegistration,
    executable: ExternalExecutableEvidence,
    assertedAttribution: [String: String]
) -> String {
    let requestID = UUID().uuidString.lowercased()
    let session = DaemonSession(socketPath: aosSocketPath(for: aosCurrentRuntimeMode()))
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0], timeoutMs: 1_000) else {
        exitError("The AOS daemon external-spawn plane is unavailable.", code: "DAEMON_UNREACHABLE")
    }
    defer { session.disconnect() }
    let request: [String: Any] = [
        "v": 1,
        "service": "operation",
        "action": "external_spawn_intent",
        "ref": requestID,
        "asserted_attribution": assertedAttribution,
        "data": [
            "schema_version": "aos.operation.external-spawn-intent-request.v1",
            "request_id": requestID,
            "route_source_id": registration.routeSourceID,
            "route_source_revision": registration.routeSourceRevision,
            "adapter_registration_id": registration.adapterRegistrationID,
            "adapter_registration_revision": registration.adapterRegistrationRevision,
            "resolved_executable": [
                "resolved_path_digest": executable.resolvedPathDigest,
                "executable_identity_digest": executable.executableIdentityDigest,
                "device": executable.device,
                "inode": executable.inode,
                "code_identity_digest": executable.codeIdentityDigest,
                "platform_code_directory_hash": executable.platformCodeDirectoryHash,
                "signing_identifier": executable.signingIdentifier,
                "signing_team_identifier": executable.signingTeamIdentifier,
                "file_digest": executable.fileDigest,
            ],
            "expected_script_identity_digest": domainSeparatedSHA256(
                domain: "aos.operation.external-script-identity.v1",
                data: Data(registration.expectedScriptIdentity.utf8)
            ),
            "expected_script_digest": registration.expectedScriptDigest,
            "reviewed_dependency_set_digest": registration.reviewedDependencySetDigest,
            "canonical_argv_shape_digest": registration.canonicalArgvShapeDigest,
        ],
    ]
    guard let response = session.sendAndReceive(request) else {
        exitExternalSpawnIntentFailure(.noResponse)
    }
    if let failure = externalSpawnIntentDaemonFailureClassification(response) {
        exitExternalSpawnIntentFailure(failure)
    }
    guard let closedResponse = externalManifestObject(
            response,
            required: ["v", "status", "ref", "data"]
          ),
          externalManifestInteger(closedResponse["v"], minimum: 1) == 1,
          closedResponse["status"] as? String == "success",
          closedResponse["ref"] as? String == requestID,
          let payload = externalManifestObject(
            closedResponse["data"],
            required: [
                "schema_version", "request_id", "spawn_record_id",
                "one_time_binding_token", "operation_id", "operation_generation",
                "adapter_registration_id", "adapter_registration_revision",
            ]
          ),
          payload["schema_version"] as? String == "aos.operation.external-spawn-intent-response.v1",
          payload["request_id"] as? String == requestID,
          externalOperationIdentifier(payload["spawn_record_id"]) != nil,
          externalOperationIdentifier(payload["operation_id"]) != nil,
          externalManifestInteger(
            payload["operation_generation"],
            minimum: 1,
            maximum: 9_007_199_254_740_991
          ) != nil,
          payload["adapter_registration_id"] as? String == registration.adapterRegistrationID,
          externalManifestInteger(
            payload["adapter_registration_revision"],
            minimum: 1,
            maximum: 9_007_199_254_740_991
          )
            == registration.adapterRegistrationRevision,
          let bindingToken = payload["one_time_binding_token"] as? String,
          bindingToken.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
        exitError("The external-spawn intent response was invalid.", code: "EXTERNAL_SPAWN_INTENT_INVALID")
    }
    return bindingToken
}

private func admitExternalSpawnChild(
    bindingToken: String,
    childPID: pid_t,
    expectedPlatformCodeDirectoryHash: String
) -> Bool {
    guard bindingToken.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
          childPID > 0,
          expectedPlatformCodeDirectoryHash.range(
            of: "^[0-9a-f]{40}$",
            options: .regularExpression
          ) != nil else {
        return false
    }
    let requestID = UUID().uuidString.lowercased()
    let session = DaemonSession(socketPath: aosSocketPath(for: aosCurrentRuntimeMode()))
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0], timeoutMs: 1_000) else {
        return false
    }
    defer { session.disconnect() }
    let response = session.sendAndReceive([
        "v": 1,
        "service": "operation",
        "action": "external_spawn_child_admit",
        "ref": requestID,
        "data": [
            "schema_version": "aos.operation.external-spawn-child-admit-request.v1",
            "request_id": requestID,
            "one_time_binding_token": bindingToken,
            "child_pid": childPID,
        ],
    ])
    guard let response,
          let closedResponse = externalManifestObject(
            response,
            required: ["v", "status", "ref", "data"]
          ),
          externalManifestInteger(closedResponse["v"], minimum: 1) == 1,
          closedResponse["status"] as? String == "success",
          closedResponse["ref"] as? String == requestID,
          let payload = externalManifestObject(
            closedResponse["data"],
            required: [
                "schema_version", "request_id", "spawn_record_id", "operation_id",
                "operation_generation", "child_pid", "child_pid_generation",
                "parent_edge_digest", "platform_code_directory_hash",
                "platform_code_directory_hash_algorithm", "outcome",
            ]
          ),
          payload["schema_version"] as? String
            == "aos.operation.external-spawn-child-admit-response.v1",
          payload["request_id"] as? String == requestID,
          externalOperationIdentifier(payload["spawn_record_id"]) != nil,
          externalOperationIdentifier(payload["operation_id"]) != nil,
          externalManifestInteger(
            payload["operation_generation"],
            minimum: 1,
            maximum: 9_007_199_254_740_991
          ) != nil,
          externalManifestInteger(
            payload["child_pid"],
            minimum: 1,
            maximum: Int(Int32.max)
          ) == Int(childPID),
          externalManifestInteger(
            payload["child_pid_generation"],
            minimum: 1,
            maximum: 9_007_199_254_740_991
          ) != nil,
          let parentEdgeDigest = payload["parent_edge_digest"] as? String,
          isLowercaseSHA256(parentEdgeDigest),
          payload["platform_code_directory_hash"] as? String
            == expectedPlatformCodeDirectoryHash,
          payload["platform_code_directory_hash_algorithm"] as? String
            == "sha256_truncated_cdhash_20_bytes",
          payload["outcome"] as? String == "generation_bound_spawn_child_admitted" else {
        return false
    }
    return true
}

private func abandonExternalSpawn(bindingToken: String) {
    guard bindingToken.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
        return
    }
    let requestID = UUID().uuidString.lowercased()
    let session = DaemonSession(socketPath: aosSocketPath(for: aosCurrentRuntimeMode()))
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0], timeoutMs: 1_000) else {
        return
    }
    defer { session.disconnect() }
    guard let response = session.sendAndReceive([
        "v": 1,
        "service": "operation",
        "action": "external_spawn_abandon",
        "ref": requestID,
        "data": [
            "schema_version": "aos.operation.external-spawn-abandon-request.v1",
            "request_id": requestID,
            "one_time_binding_token": bindingToken,
        ],
    ]),
    let closedResponse = externalManifestObject(
        response,
        required: ["v", "status", "ref", "data"]
    ),
    externalManifestInteger(closedResponse["v"], minimum: 1) == 1,
    closedResponse["status"] as? String == "success",
    closedResponse["ref"] as? String == requestID,
    let payload = externalManifestObject(
        closedResponse["data"],
        required: [
            "schema_version", "request_id", "spawn_record_id", "operation_id",
            "operation_generation", "outcome",
        ]
    ),
    payload["schema_version"] as? String
        == "aos.operation.external-spawn-abandon-response.v1",
    payload["request_id"] as? String == requestID,
    externalOperationIdentifier(payload["spawn_record_id"]) != nil,
    externalOperationIdentifier(payload["operation_id"]) != nil,
    externalManifestInteger(
        payload["operation_generation"],
        minimum: 1,
        maximum: 9_007_199_254_740_991
    ) != nil,
    payload["outcome"] as? String == "prepared_operation_abandoned" else {
        return
    }
}

private func isLowercaseSHA256(_ value: String) -> Bool {
    value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
}

private func isNormalizedRepoRelativeIdentity(_ value: String) -> Bool {
    guard !value.isEmpty, !value.hasPrefix("/"), !value.contains("\\") else { return false }
    let components = value.split(separator: "/", omittingEmptySubsequences: false)
    return components.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
}

private func canonicalRegularFile(root: URL, identity: String) -> (URL, Data)? {
    guard isNormalizedRepoRelativeIdentity(identity) else { return nil }
    let authored = root.appendingPathComponent(identity, isDirectory: false).standardizedFileURL
    let canonical = authored.resolvingSymlinksInPath().standardizedFileURL
    var fileStat = stat()
    guard canonical.path == authored.path,
          canonical.path.hasPrefix("\(root.path)/"),
          lstat(authored.path, &fileStat) == 0,
          (fileStat.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
          let bytes = try? Data(contentsOf: canonical) else {
        return nil
    }
    return (canonical, bytes)
}

private func reviewedDependencySetDigest(
    _ dependencies: [ExternalCommandReviewedDependency]
) -> String? {
    let payload = dependencies.map { dependency in
        ["identity": dependency.identity, "digest": dependency.digest]
    }
    guard let bytes = try? JSONSerialization.data(
        withJSONObject: payload,
        options: [.sortedKeys, .withoutEscapingSlashes]
    ) else {
        return nil
    }
    return sha256Hex(bytes)
}

private func reviewedDependencyEvidence(
    _ dependencies: [ExternalCommandReviewedDependency],
    expectedSetDigest: String,
    root: URL
) -> [String: Data]? {
    guard dependencies.map(\.identity) == reviewedExternalSpawnDependencyIdentities,
          reviewedDependencySetDigest(dependencies) == expectedSetDigest else {
        return nil
    }
    var evidence: [String: Data] = [:]
    for dependency in dependencies {
        guard isLowercaseSHA256(dependency.digest),
              let (_, bytes) = canonicalRegularFile(root: root, identity: dependency.identity),
              sha256Hex(bytes) == dependency.digest else {
            return nil
        }
        evidence[dependency.identity] = bytes
    }
    return evidence
}

private func jsonStringLiteral(_ value: String) -> String? {
    guard let data = try? JSONEncoder().encode(value) else { return nil }
    return String(data: data, encoding: .utf8)
}

private func replacingExactlyOnce(
    _ source: String,
    target: String,
    replacement: String
) -> String? {
    let pieces = source.components(separatedBy: target)
    guard pieces.count == 2 else { return nil }
    return pieces[0] + replacement + pieces[1]
}

private func makeRegisteredExternalLaunchBundle(
    entryBytes: Data,
    dependencyBytes: [String: Data],
    reviewedDependencySetDigest: String,
    lifecycleParentPID: Int32
) -> Data? {
    guard entryBytes.count <= reviewedExternalSpawnSourceMaxBytes,
          dependencyBytes.values.allSatisfy({ $0.count <= reviewedExternalSpawnSourceMaxBytes }),
          isLowercaseSHA256(reviewedDependencySetDigest),
          lifecycleParentPID > 0,
          var entrySource = String(data: entryBytes, encoding: .utf8),
          var voiceSource = dependencyBytes["scripts/lib/aos-voice-follow.mjs"]
            .flatMap({ String(data: $0, encoding: .utf8) }),
          let daemonClientBytes = dependencyBytes["scripts/lib/aos-daemon-client.mjs"] else {
        return nil
    }
    let daemonClientURL = "data:text/javascript;base64,\(daemonClientBytes.base64EncodedString())"
    guard let daemonClientLiteral = jsonStringLiteral(daemonClientURL),
          let rewrittenVoice = replacingExactlyOnce(
            voiceSource,
            target: "'./aos-daemon-client.mjs'",
            replacement: daemonClientLiteral
          ) else {
        return nil
    }
    guard let setKeyLiteral = jsonStringLiteral(
            externalDispatchReviewedDependencySetDigestEnvironmentKey
          ),
          let lifecycleKeyLiteral = jsonStringLiteral(
            externalDispatchLifecycleParentPIDEnvironmentKey
          ),
          let setDigestLiteral = jsonStringLiteral(reviewedDependencySetDigest),
          let lifecyclePIDLiteral = jsonStringLiteral(String(lifecycleParentPID)) else {
        return nil
    }
    let prelude = """
    process.env[\(setKeyLiteral)] = \(setDigestLiteral);
    process.env[\(lifecycleKeyLiteral)] = \(lifecyclePIDLiteral);
    """
    voiceSource = prelude + "\n" + rewrittenVoice
    let voiceURL = "data:text/javascript;base64,\(Data(voiceSource.utf8).base64EncodedString())"
    guard let voiceLiteral = jsonStringLiteral(voiceURL),
          let rewrittenEntry = replacingExactlyOnce(
            entrySource,
            target: "'./lib/aos-voice-follow.mjs'",
            replacement: voiceLiteral
          ) else {
        return nil
    }
    entrySource = rewrittenEntry
    let bundle = Data(entrySource.utf8)
    return bundle.count <= reviewedExternalSpawnBundleMaxBytes ? bundle : nil
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func domainSeparatedSHA256(domain: String, data: Data) -> String {
    var payload = Data(domain.utf8)
    payload.append(0)
    payload.append(data)
    return sha256Hex(payload)
}

private func canonicalArgvShapeDigest(_ argvPrefix: [String]) -> String? {
    let shape: [String: Any] = [
        "argv_prefix": argvPrefix,
        "forwarded_suffix": "path_suffix_after_route",
    ]
    guard let data = try? JSONSerialization.data(
        withJSONObject: shape,
        options: [.sortedKeys, .withoutEscapingSlashes]
    ) else {
        return nil
    }
    return sha256Hex(data)
}

private func resolveNodeFromSanitizedPath() -> String? {
    let authoredPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
    let fallback = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    var directories: [String] = []
    for candidate in authoredPath.split(separator: ":", omittingEmptySubsequences: false).map(String.init) + fallback {
        guard candidate.hasPrefix("/"),
              !candidate.split(separator: "/").contains("..") else { continue }
        let standardized = NSString(string: candidate).standardizingPath
        guard standardized == candidate, !directories.contains(candidate) else { continue }
        directories.append(candidate)
    }
    for directory in directories {
        let candidate = (directory as NSString).appendingPathComponent("node")
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate, isDirectory: &isDirectory),
              !isDirectory.boolValue,
              FileManager.default.isExecutableFile(atPath: candidate) else { continue }
        return URL(fileURLWithPath: candidate).resolvingSymlinksInPath().path
    }
    return nil
}

private func externalCommandPathMatches(_ path: [String], args: [String]) -> Bool {
    guard !path.isEmpty, args.count >= path.count else {
        return false
    }
    return Array(args.prefix(path.count)) == path
}

private func externalCommandMatches(_ command: ExternalCommand, args: [String]) -> Bool {
    guard externalCommandPathMatches(command.path, args: args) else {
        return false
    }
    guard let condition = command.when else {
        return true
    }
    let childArgs = Array(args.dropFirst(command.path.count))
    if let childArgIndex = condition.childArgIndex {
        guard childArgIndex >= 0 else { return false }
        guard childArgs.indices.contains(childArgIndex) else {
            return condition.childArgMissing == true
        }
        if condition.childArgMissing == true { return false }
        let childArg = childArgs[childArgIndex]
        if let prefix = condition.prefix, !childArg.hasPrefix(prefix) {
            return false
        }
        if condition.excludedPrefixes?.contains(where: { childArg.hasPrefix($0) }) == true {
            return false
        }
        if condition.excludedValues?.contains(childArg) == true { return false }
    }
    return true
}

private func rawOptionValue(_ args: [String], _ token: String) -> String? {
    var i = 0
    while i < args.count {
        if args[i] == token, i + 1 < args.count {
            let value = args[i + 1]
            if !value.hasPrefix("--") {
                return value
            }
        }
        i += 1
    }
    return nil
}

private func resolveExternalRepoRoot(_ requested: String?) -> String {
    let start = NSString(string: requested ?? FileManager.default.currentDirectoryPath).expandingTildeInPath
    let result = runExternalProcessCapturingOutput("/usr/bin/git", arguments: ["rev-parse", "--show-toplevel"], cwd: start)
    if result.exitCode == 0 {
        let root = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !root.isEmpty {
            return root
        }
    }
    return NSString(string: start).standardizingPath
}

private func resolveExternalExecutable(_ value: String, repoRoot: String, aosRepoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    return resolveExternalArg(value, repoRoot: repoRoot, aosRepoRoot: aosRepoRoot)
}

private func resolveExternalArg(_ value: String, repoRoot: String, aosRepoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    if value.hasPrefix("$AOS_REPO_ROOT/") {
        return (aosRepoRoot as NSString).appendingPathComponent(String(value.dropFirst("$AOS_REPO_ROOT/".count)))
    }
    if value == "$AOS_REPO_ROOT" {
        return aosRepoRoot
    }
    if value.hasPrefix("$REPO_ROOT/") {
        return (repoRoot as NSString).appendingPathComponent(String(value.dropFirst("$REPO_ROOT/".count)))
    }
    if value == "$REPO_ROOT" {
        return repoRoot
    }
    if value == "$AOS_RUNTIME_MODE" {
        return aosCurrentRuntimeMode().rawValue
    }
    if value == "$AOS_STATE_ROOT" {
        return aosStateRoot()
    }
    if value == "$AOS_PATH" {
        var pathBuffer = [CChar](repeating: 0, count: 4 * 1_024)
        if proc_pidpath(getpid(), &pathBuffer, UInt32(pathBuffer.count)) > 0 {
            return URL(fileURLWithPath: String(cString: pathBuffer))
                .resolvingSymlinksInPath().standardizedFileURL.path
        }
        let authored = CommandLine.arguments.first ?? "./aos"
        return URL(
            fileURLWithPath: authored,
            relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        ).standardizedFileURL.path
    }
    if value == "$AOS_SESSION_KEY" {
        return aosCurrentSessionKey()
    }
    if value == "$AOS_SESSION_HARNESS" {
        return aosCurrentSessionHarness()
    }
    if value == "$AOS_INVOCATION_DISPLAY_NAME" {
        return aosInvocationDisplayName()
    }
    return value
}

private func resolveExternalEnvironment(
    _ env: [String: String],
    repoRoot: String,
    aosRepoRoot: String
) -> [String: String] {
    var resolved: [String: String] = [:]
    for (key, value) in env {
        resolved[key] = resolveExternalArg(value, repoRoot: repoRoot, aosRepoRoot: aosRepoRoot)
    }
    return resolved
}

private func registeredExternalSpawnEnvironment(authored: [String: String]) -> [String: String] {
    guard !authored.keys.contains(where: registeredSpawnEnvironmentKeyIsUnsafe),
          authored[externalDispatchBindingTokenEnvironmentKey] == nil,
          authored[legacyExternalDispatchParentPIDEnvironmentKey] == nil,
          authored[externalDispatchLifecycleParentPIDEnvironmentKey] == nil,
          authored[externalDispatchReviewedDependencySetDigestEnvironmentKey] == nil else {
        exitError("Registered external spawn authored an unsafe environment.", code: "INVALID_MANIFEST")
    }
    let inherited = ProcessInfo.processInfo.environment
    var environment: [String: String] = [:]
    for key in registeredExternalSpawnInheritedEnvironmentKeys {
        if let value = inherited[key] { environment[key] = value }
    }
    for (key, value) in authored { environment[key] = value }
    return environment
}

private func runRegisteredExternalProcess(
    _ launch: ResolvedRegisteredExternalSpawn,
    cwd: String?,
    environment: [String: String]
) -> Int32 {
    let process = Process()
    let sourcePipe = Pipe()
    guard fcntl(sourcePipe.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1) == 0 else {
        if let bindingToken = launch.bindingToken {
            abandonExternalSpawn(bindingToken: bindingToken)
        }
        return 1
    }
    process.executableURL = URL(fileURLWithPath: launch.executable)
    process.arguments = launch.arguments
    if let cwd { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
    process.environment = environment
    process.standardInput = sourcePipe
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    defer {
        try? sourcePipe.fileHandleForWriting.close()
        try? sourcePipe.fileHandleForReading.close()
    }

    do {
        try process.run()
    } catch {
        if let bindingToken = launch.bindingToken {
            abandonExternalSpawn(bindingToken: bindingToken)
        }
        if let data = "\(error)\n".data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
        return 1
    }
    try? sourcePipe.fileHandleForReading.close()

    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT)
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let forwardWithEscalation: (Int32) -> Void = { forwardedSignal in
        let childPID = process.processIdentifier
        guard childPID > 0 else { return }
        _ = Darwin.kill(childPID, forwardedSignal)
        DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(2)) {
            if process.isRunning { _ = Darwin.kill(childPID, SIGKILL) }
        }
    }
    sigterm.setEventHandler { forwardWithEscalation(SIGTERM) }
    sigint.setEventHandler { forwardWithEscalation(SIGINT) }
    sigterm.resume()
    sigint.resume()
    defer {
        sigterm.cancel()
        sigint.cancel()
    }

    if let bindingToken = launch.bindingToken,
       !admitExternalSpawnChild(
        bindingToken: bindingToken,
        childPID: process.processIdentifier,
        expectedPlatformCodeDirectoryHash: launch.expectedPlatformCodeDirectoryHash
       ) {
        terminateRegisteredExternalProcess(process)
        abandonExternalSpawn(bindingToken: bindingToken)
        return 1
    }

    do {
        try sourcePipe.fileHandleForWriting.write(contentsOf: launch.launchBundle)
        try sourcePipe.fileHandleForWriting.close()
    } catch {
        terminateRegisteredExternalProcess(process)
        if let bindingToken = launch.bindingToken {
            abandonExternalSpawn(bindingToken: bindingToken)
        }
        return 1
    }

    process.waitUntilExit()
    if let bindingToken = launch.bindingToken {
        abandonExternalSpawn(bindingToken: bindingToken)
    }
    return process.terminationStatus
}

private func terminateRegisteredExternalProcess(_ process: Process) {
    let childPID = process.processIdentifier
    guard childPID > 0 else { return }
    if process.isRunning { _ = Darwin.kill(childPID, SIGTERM) }
    for _ in 0..<50 where process.isRunning {
        usleep(10_000)
    }
    if process.isRunning { _ = Darwin.kill(childPID, SIGKILL) }
    process.waitUntilExit()
}

private func runExternalProcessInheritingStdio(
    _ executable: String,
    arguments: [String],
    cwd: String? = nil,
    environment: [String: String]? = nil,
    environmentIsComplete: Bool = false
) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }
    var merged = environmentIsComplete ? [:] : ProcessInfo.processInfo.environment
    merged.removeValue(forKey: legacyExternalDispatchParentPIDEnvironmentKey)
    merged.removeValue(forKey: externalDispatchBindingTokenEnvironmentKey)
    merged.removeValue(forKey: externalDispatchLifecycleParentPIDEnvironmentKey)
    merged.removeValue(forKey: externalDispatchReviewedDependencySetDigestEnvironmentKey)
    if let environment {
        for (key, value) in environment {
            merged[key] = value
        }
    }
    merged[externalDispatchLifecycleParentPIDEnvironmentKey]
        = String(ProcessInfo.processInfo.processIdentifier)
    process.environment = merged
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    do {
        try process.run()
    } catch {
        if let data = "\(error)\n".data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
        return 1
    }

    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT)
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    sigterm.setEventHandler {
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGTERM)
        }
    }
    sigint.setEventHandler {
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGINT)
        }
    }
    sigterm.resume()
    sigint.resume()
    process.waitUntilExit()
    sigterm.cancel()
    sigint.cancel()
    return process.terminationStatus
}

private func runExternalProcessCapturingOutput(
    _ executable: String,
    arguments: [String],
    cwd: String? = nil,
    environment: [String: String]? = nil,
    environmentIsComplete: Bool = false
) -> ProcessOutput {
    let process = Process()
    let stdoutURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("aos-external-stdout-\(UUID().uuidString)")
    let stderrURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("aos-external-stderr-\(UUID().uuidString)")
    FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
    FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
    guard let stdout = try? FileHandle(forWritingTo: stdoutURL),
          let stderr = try? FileHandle(forWritingTo: stderrURL) else {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "Could not create temporary command output files")
    }
    defer {
        try? stdout.close()
        try? stderr.close()
        try? FileManager.default.removeItem(at: stdoutURL)
        try? FileManager.default.removeItem(at: stderrURL)
    }

    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }
    var merged = environmentIsComplete ? [:] : ProcessInfo.processInfo.environment
    merged.removeValue(forKey: legacyExternalDispatchParentPIDEnvironmentKey)
    merged.removeValue(forKey: externalDispatchBindingTokenEnvironmentKey)
    merged.removeValue(forKey: externalDispatchLifecycleParentPIDEnvironmentKey)
    merged.removeValue(forKey: externalDispatchReviewedDependencySetDigestEnvironmentKey)
    if let environment {
        for (key, value) in environment {
            merged[key] = value
        }
    }
    merged[externalDispatchLifecycleParentPIDEnvironmentKey]
        = String(ProcessInfo.processInfo.processIdentifier)
    process.environment = merged
    process.standardOutput = stdout
    process.standardError = stderr

    do {
        try process.run()
    } catch {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "\(error)")
    }

    process.waitUntilExit()
    try? stdout.synchronize()
    try? stderr.synchronize()

    return ProcessOutput(
        exitCode: process.terminationStatus,
        stdout: (try? String(contentsOf: stdoutURL, encoding: .utf8)) ?? "",
        stderr: (try? String(contentsOf: stderrURL, encoding: .utf8)) ?? ""
    )
}
