# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Rust calls MainActivity.restartApp() by name over JNI (src/commands/client_mode.rs). Nothing in
# Kotlin refers to it, so a release build's R8 would strip or rename it and the call would find
# no such method: the app would never restart after a server setting changed.
-keepclassmembers class com.atai.arlesh.MainActivity {
    public void restartApp();
}
-keep class com.atai.arlesh.RestartActivity
