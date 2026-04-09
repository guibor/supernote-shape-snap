package com.supernote_shape_snap

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class ExportFileModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ExportFileModule"

  @ReactMethod
  fun writeUtf8File(filePath: String, contents: String, promise: Promise) {
    try {
      val targetFile = File(filePath)
      val parent = targetFile.parentFile
      if (parent != null && !parent.exists()) {
        parent.mkdirs()
      }

      targetFile.writeText(contents, Charsets.UTF_8)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("WRITE_UTF8_FILE_FAILED", error)
    }
  }
}
