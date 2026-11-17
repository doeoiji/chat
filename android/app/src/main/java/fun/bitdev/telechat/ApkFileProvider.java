package fun.bitdev.telechat;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Lightweight ContentProvider for serving only the downloaded TeleChat update APK
 * to the Android Package Installer without external AndroidX dependencies.
 */
public class ApkFileProvider extends ContentProvider {

    public static final String APK_MIME = "application/vnd.android.package-archive";

    public static Uri getUriForUpdateApk(android.content.Context ctx, String fileName) {
        return new Uri.Builder()
            .scheme("content")
            .authority(ctx.getPackageName() + ".apkprovider")
            .appendPath("updates")
            .appendPath(fileName)
            .build();
    }

    private File resolveUpdateFile(Uri uri) throws FileNotFoundException {
        if (getContext() == null || uri == null) {
            throw new FileNotFoundException("Invalid context or URI");
        }
        String last = uri.getLastPathSegment();
        if (last == null || last.contains("..") || !last.endsWith(".apk")) {
            throw new FileNotFoundException("Invalid APK path");
        }
        File updatesDir = new File(getContext().getFilesDir(), "updates");
        File target = new File(updatesDir, last);
        try {
            String canonicalDir = updatesDir.getCanonicalPath() + File.separator;
            String canonicalTarget = target.getCanonicalPath();
            if (!canonicalTarget.startsWith(canonicalDir) || !target.isFile()) {
                throw new FileNotFoundException("APK not found");
            }
        } catch (Exception e) {
            throw new FileNotFoundException("Invalid APK path");
        }
        return target;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return APK_MIME;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolveUpdateFile(uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File file = resolveUpdateFile(uri);
            String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor cursor = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) {
                    row[i] = file.getName();
                } else if (OpenableColumns.SIZE.equals(cols[i])) {
                    row[i] = file.length();
                }
            }
            cursor.addRow(row);
            return cursor;
        } catch (FileNotFoundException e) {
            return new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, 0);
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
