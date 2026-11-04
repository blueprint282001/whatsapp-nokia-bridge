package whatsapp;

import java.io.InputStream;
import java.io.OutputStream;
import javax.microedition.io.Connector;
import javax.microedition.io.HttpConnection;

public class HttpHelper {

    public interface HttpCallback {
        void onSuccess(String response);
        void onError(String error);
    }

    public static void getAsync(final String url, final HttpCallback callback) {
        new Thread(new Runnable() {
            public void run() {
                HttpConnection conn = null;
                InputStream is = null;
                try {
                    conn = (HttpConnection) Connector.open(url, Connector.READ, true);
                    conn.setRequestMethod(HttpConnection.GET);
                    conn.setRequestProperty("User-Agent", "NokiaC2-01-J2ME-WhatsApp/1.0");

                    int rc = conn.getResponseCode();
                    is = conn.openInputStream();

                    StringBuffer sb = new StringBuffer();
                    int ch;
                    while ((ch = is.read()) != -1) {
                        sb.append((char) ch);
                    }

                    if (callback != null) {
                        if (rc == HttpConnection.HTTP_OK) {
                            callback.onSuccess(sb.toString());
                        } else {
                            callback.onError("HTTP " + rc + ": " + sb.toString());
                        }
                    }
                } catch (Exception e) {
                    if (callback != null) {
                        callback.onError(e.getMessage() != null ? e.getMessage() : e.toString());
                    }
                } finally {
                    try { if (is != null) is.close(); } catch (Exception e) {}
                    try { if (conn != null) conn.close(); } catch (Exception e) {}
                }
            }
        }).start();
    }

    public static void postAsync(final String url, final String postData, final HttpCallback callback) {
        new Thread(new Runnable() {
            public void run() {
                HttpConnection conn = null;
                OutputStream os = null;
                InputStream is = null;
                try {
                    conn = (HttpConnection) Connector.open(url, Connector.READ_WRITE, true);
                    conn.setRequestMethod(HttpConnection.POST);
                    conn.setRequestProperty("User-Agent", "NokiaC2-01-J2ME-WhatsApp/1.0");
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");

                    byte[] postBytes = postData.getBytes();
                    conn.setRequestProperty("Content-Length", Integer.toString(postBytes.length));

                    os = conn.openOutputStream();
                    os.write(postBytes);
                    os.flush();

                    int rc = conn.getResponseCode();
                    is = conn.openInputStream();

                    StringBuffer sb = new StringBuffer();
                    int ch;
                    while ((ch = is.read()) != -1) {
                        sb.append((char) ch);
                    }

                    if (callback != null) {
                        if (rc == HttpConnection.HTTP_OK) {
                            callback.onSuccess(sb.toString());
                        } else {
                            callback.onError("HTTP " + rc + ": " + sb.toString());
                        }
                    }
                } catch (Exception e) {
                    if (callback != null) {
                        callback.onError(e.getMessage() != null ? e.getMessage() : e.toString());
                    }
                } finally {
                    try { if (os != null) os.close(); } catch (Exception e) {}
                    try { if (is != null) is.close(); } catch (Exception e) {}
                    try { if (conn != null) conn.close(); } catch (Exception e) {}
                }
            }
        }).start();
    }
}
