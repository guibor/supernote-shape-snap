import {PluginManager} from 'sn-plugin-lib';

export const FILE_READ_PERMISSION = 'plugin.permission.FILE:READ';
export const FILE_WRITE_PERMISSION = 'plugin.permission.FILE:WRITE';
export const INTERNET_PERMISSION = 'plugin.permission.INTERNET';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [FILE_READ_PERMISSION]:
    'This plugin needs access to the selected Supernote content.',
  [FILE_WRITE_PERMISSION]:
    'This plugin needs permission to update the current Supernote file.',
  [INTERNET_PERMISSION]:
    'This plugin needs internet access to complete the requested action.',
};

/**
 * Ensures every declared SDK permission is available before an action runs.
 * Both one-session and persistent grants are accepted.
 */
export async function ensurePermissions(
  permissions: readonly string[],
): Promise<void> {
  for (const permission of [...new Set(permissions)]) {
    const status = await PluginManager.hasPermission(permission);
    if (status === 1 || status === 2) {
      continue;
    }

    const result = await PluginManager.requestPermission(
      permission,
      PERMISSION_DESCRIPTIONS[permission],
    );
    if (result !== 1 && result !== 2) {
      throw new Error(`Permission not granted: ${permission}`);
    }
  }
}

