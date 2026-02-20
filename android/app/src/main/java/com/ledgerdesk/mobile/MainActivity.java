package com.ledgerdesk.mobile;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    stabilizeScaleSettings();
  }

  @Override
  public void onResume() {
    super.onResume();
    stabilizeScaleSettings();
  }

  private void stabilizeScaleSettings() {
    if (bridge == null || bridge.getWebView() == null) {
      return;
    }

    WebSettings settings = bridge.getWebView().getSettings();
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setUseWideViewPort(false);
    settings.setLoadWithOverviewMode(false);
    settings.setTextZoom(100);
  }
}
