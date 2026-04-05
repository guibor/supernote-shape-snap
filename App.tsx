/**
 * Snap Shape plugin fallback view.
 *
 * @format
 */

import React from 'react';
import {StatusBar, StyleSheet, Text, View} from 'react-native';

function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f4f1ea" />
      <Text style={styles.title}>Snap Shape</Text>
      <Text style={styles.copy}>
        This plugin runs directly from the lasso toolbar.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f4f1ea',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1f1f1f',
    marginBottom: 10,
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    color: '#454038',
  },
});

export default App;
