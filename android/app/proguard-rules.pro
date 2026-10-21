# Souffleur TWA — R8 rules.

# JavaScript bridge of the WebView fallback (methods are called by name from the page).
-keepattributes JavascriptInterface
-keepclassmembers class io.github.cmssmc_code.souffleur.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Compile-time-only annotations referenced by Guava (pulled in by androidbrowserhelper).
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.google.j2objc.annotations.**
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
-dontwarn afu.org.checkerframework.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
