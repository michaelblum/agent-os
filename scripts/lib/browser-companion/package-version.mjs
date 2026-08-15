const PACKAGE_VERSION = /^(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9][0-9]{0,9})(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const PACKAGE_ENTRYPOINT = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9@._+~/-]+$/u;

export function isBoundedPackageVersion(value) {
  return typeof value === 'string' && value.length <= 128 && PACKAGE_VERSION.test(value);
}

export function isBoundedPackageEntrypoint(value) {
  return typeof value === 'string' && value.length <= 256 && PACKAGE_ENTRYPOINT.test(value);
}

export function requireBoundedPackageVersion(value, fail) {
  if (!isBoundedPackageVersion(value)) fail('managed package version is invalid');
  return value;
}

export function requireBoundedPackageEntrypoint(value, fail) {
  if (!isBoundedPackageEntrypoint(value)) fail('managed package entrypoint is invalid');
  return value;
}
