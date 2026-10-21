package io.github.cmssmc_code.souffleur;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

/** Launches a home-screen shortcut when the app is not running; same fallback as the launcher. */
public class ColdShortcutActivity extends com.google.androidbrowserhelper.trusted.ColdShortcutActivity {
    @Override
    protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return WebFallbackActivity.FALLBACK_STRATEGY;
    }
}
