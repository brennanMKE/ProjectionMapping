package com.pimapper.projlight;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restart the light-control service after the projector boots. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            context.startForegroundService(new Intent(context, LightService.class));
        }
    }
}
