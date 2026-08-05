// skipcq: JS-0833
// The modules a workspace-access session can be pointed at, and where each one
// lands.
//
// Shared because two surfaces drive the same override: the Workspace Access
// panel in the portals, and the read-only banner's module switcher in the app
// chrome. They were one list copied into two files for about an hour, which is
// exactly how a module gets added to one switcher and not the other.
//
// `value` matches the backend module claim (X-Override-Module), so it must stay
// in step with app/domain/schemas/business_admin.py's Module literal.
export const WORKSPACE_MODULES = [
  { value: 'bd',                  label: 'BD',                  route: '/' },
  { value: 'legal',               label: 'Legal',               route: '/legal' },
  { value: 'design',              label: 'Design',              route: '/design' },
  { value: 'project_excellence',  label: 'Project Excellence',  route: '/project-excellence' },
  { value: 'project',             label: 'Project',             route: '/project' },
  { value: 'nso',                 label: 'NSO',                 route: '/nso' },
];

export function workspaceModule(value) {
  return WORKSPACE_MODULES.find((m) => m.value === value) || null;
}

export function workspaceModuleLabel(value) {
  return workspaceModule(value)?.label || null;
}

// Where entering `module` should land. Falls back to the app root rather than
// throwing, so an unrecognised claim degrades to the overview instead of a
// blank screen.
export function workspaceModuleRoute(value) {
  return workspaceModule(value)?.route || '/';
}
