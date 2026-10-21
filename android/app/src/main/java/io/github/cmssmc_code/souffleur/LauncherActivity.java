package io.github.cmssmc_code.souffleur;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Entry point: opens the web app in a Trusted Web Activity (Chrome, Edge, Samsung Internet…).
 * Configuration lives in AndroidManifest.xml meta-data. When no installed browser supports
 * TWAs, the app opens in {@link WebFallbackActivity} (microphone, file import and exports work).
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return WebFallbackActivity.FALLBACK_STRATEGY;
    }
}
