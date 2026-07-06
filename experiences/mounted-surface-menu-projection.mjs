export const MOUNTED_SURFACE_MENU_QUERY_PARAM = 'aos_mounted_surface_menu';
export const MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION = 'aos.mounted-surface-menu-projection.v0';

export function mountedSurfaceMenuProjectionEnvelope({
  experienceId,
  surfaceId,
  menu = [],
} = {}) {
  return {
    schema_version: MOUNTED_SURFACE_MENU_PROJECTION_SCHEMA_VERSION,
    experience_id: experienceId,
    surface_id: surfaceId,
    menu,
  };
}
