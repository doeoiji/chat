package fun.bitdev.telechat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * Receives Android PackageInstaller session results so the in-app updater
 * can launch the user confirmation prompt and report exact install errors.
 */
public class UpdateInstallReceiver extends BroadcastReceiver {

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmIntent = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmIntent != null) {
                confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirmIntent);
                } catch (Exception e) {
                    UpdateManager.notifyInstallFailure("Could not open Android installer: " + e.getMessage());
                }
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            UpdateManager.notifyInstallSuccess();
            return;
        }

        String rawMsg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_FAILURE_CONFLICT
            || (rawMsg != null && (rawMsg.contains("INCOMPATIBLE") || rawMsg.toLowerCase().contains("signature")))) {
            UpdateManager.notifyInstallFailure(
                "Installed version has a different signing key. Please uninstall the old TeleChat once, then install this update."
            );
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            UpdateManager.notifyInstallFailure("Installation cancelled.");
        } else {
            UpdateManager.notifyInstallFailure(
                rawMsg != null && !rawMsg.isEmpty() ? rawMsg : ("Installation failed (code " + status + ").")
            );
        }
    }
}
