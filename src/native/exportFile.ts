import {NativeModules} from 'react-native';

type ExportFileModuleShape = {
  writeUtf8File(filePath: string, contents: string): Promise<boolean>;
};

const ExportFileModule = NativeModules.ExportFileModule as ExportFileModuleShape;

if (!ExportFileModule?.writeUtf8File) {
  throw new Error('ExportFileModule is not available');
}

export async function writeUtf8File(
  filePath: string,
  contents: string,
): Promise<void> {
  const success = await ExportFileModule.writeUtf8File(filePath, contents);
  if (!success) {
    throw new Error(`Failed to write file: ${filePath}`);
  }
}
