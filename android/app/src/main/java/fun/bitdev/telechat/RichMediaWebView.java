package fun.bitdev.telechat;

import android.annotation.SuppressLint;
import android.content.ClipDescription;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.view.inputmethod.InputContentInfo;
import android.webkit.WebView;

/**
 * WebView subclass that enables IME Rich Content Insertion (commitContent) on Android 7.1+
 * so users can insert Stickers and GIFs directly from Gboard, SwiftKey, and Samsung Keyboard.
 */
public class RichMediaWebView extends WebView {

    public interface RichContentListener {
        void onRichContent(Uri contentUri, String mimeType, Runnable releasePermission);
    }

    private static final String[] SUPPORTED_MIME_TYPES = new String[] {
        "image/gif",
        "image/webp",
        "image/png",
        "image/jpeg",
        "image/apng",
        "image/*"
    };

    private RichContentListener richContentListener;

    public RichMediaWebView(Context context) {
        super(context);
    }

    public RichMediaWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setRichContentListener(RichContentListener listener) {
        this.richContentListener = listener;
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection base = super.onCreateInputConnection(outAttrs);
        if (base == null || outAttrs == null) {
            return base;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1 && richContentListener != null) {
            return Api25Compat.wrap(base, outAttrs, SUPPORTED_MIME_TYPES, richContentListener);
        }
        return base;
    }

    private static final class Api25Compat {
        @SuppressLint("NewApi")
        static InputConnection wrap(
            InputConnection base,
            EditorInfo outAttrs,
            String[] mimeTypes,
            RichContentListener listener
        ) {
            outAttrs.contentMimeTypes = mimeTypes;
            return new InputConnectionWrapper(base, false) {
                @Override
                public boolean commitContent(InputContentInfo inputContentInfo, int flags, Bundle opts) {
                    if (inputContentInfo == null) {
                        return false;
                    }
                    boolean permissionGranted = false;
                    if ((flags & InputConnection.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
                        try {
                            inputContentInfo.requestPermission();
                            permissionGranted = true;
                        } catch (Exception e) {
                            return false;
                        }
                    }
                    ClipDescription desc = inputContentInfo.getDescription();
                    String mime = (desc != null && desc.getMimeTypeCount() > 0) ? desc.getMimeType(0) : null;
                    final boolean needsRelease = permissionGranted;
                    final InputContentInfo captured = inputContentInfo;
                    listener.onRichContent(inputContentInfo.getContentUri(), mime, () -> {
                        if (needsRelease) {
                            try {
                                captured.releasePermission();
                            } catch (Exception ignored) {
                            }
                        }
                    });
                    return true;
                }
            };
        }
    }
}
