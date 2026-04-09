/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
import {SNAP_SHAPE_BUTTON_ID, snapCurrentSelection} from './src/shapeSnap';
import {
  EXPORT_NOTE_BUTTON_ID,
  EXPORT_SAMPLE_BUTTON_ID,
  exportCurrentLassoSample,
  exportCurrentNoteDataset,
} from './src/exportDataset';

const iconUri = Image.resolveAssetSource(require('./assets/icon.png')).uri;
const SUPPORTED_LASSO_DATA_TYPES = [0, 1, 2, 3, 4, 5];

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

PluginManager.registerButton(2, ['NOTE', 'DOC'], {
  id: SNAP_SHAPE_BUTTON_ID,
  name: 'Snap Shapes',
  icon: iconUri,
  editDataTypes: SUPPORTED_LASSO_DATA_TYPES,
  showType: 0,
});

PluginManager.registerButton(2, ['NOTE', 'DOC'], {
  id: EXPORT_SAMPLE_BUTTON_ID,
  name: 'Export Sample',
  icon: iconUri,
  editDataTypes: SUPPORTED_LASSO_DATA_TYPES,
  showType: 0,
});

PluginManager.registerButton(1, ['NOTE'], {
  id: EXPORT_NOTE_BUTTON_ID,
  name: 'Export Note',
  icon: iconUri,
  showType: 0,
});

PluginManager.registerButtonListener({
  onButtonPress(event) {
    if (event.id === SNAP_SHAPE_BUTTON_ID) {
      void snapCurrentSelection();
      return;
    }

    if (event.id === EXPORT_SAMPLE_BUTTON_ID) {
      void exportCurrentLassoSample();
      return;
    }

    if (event.id === EXPORT_NOTE_BUTTON_ID) {
      void exportCurrentNoteDataset();
    }
  },
});
