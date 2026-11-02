package com.exammate.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "(function(){try{var event=new Event('exammate:back',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented?'handled':'unhandled';}catch(e){return 'unhandled';}})()",
                value -> {
                    if (!"\"handled\"".equals(value)) {
                        MainActivity.super.onBackPressed();
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExamMateMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
