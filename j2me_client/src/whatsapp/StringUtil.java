package whatsapp;

import java.util.Vector;

/**
 * Lightweight string utilities compatible with J2ME CLDC 1.1 / MIDP 2.0.
 */
public class StringUtil {

    /**
     * Splits a string by a single character delimiter.
     * Essential because CLDC 1.1 does not have String.split() or regex.
     */
    public static String[] split(String str, char delimiter) {
        if (str == null) return new String[0];
        Vector list = new Vector();
        int start = 0;
        int len = str.length();

        for (int i = 0; i < len; i++) {
            if (str.charAt(i) == delimiter) {
                list.addElement(str.substring(start, i));
                start = i + 1;
            }
        }
        if (start <= len) {
            list.addElement(str.substring(start, len));
        }

        String[] result = new String[list.size()];
        for (int i = 0; i < list.size(); i++) {
            result[i] = (String) list.elementAt(i);
        }
        return result;
    }

    /**
     * URL encodes string for application/x-www-form-urlencoded payloads.
     */
    public static String urlEncode(String s) {
        if (s == null) return "";
        StringBuffer sbuf = new StringBuffer();
        int len = s.length();
        for (int i = 0; i < len; i++) {
            char ch = s.charAt(i);
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '*') {
                sbuf.append(ch);
            } else if (ch == ' ') {
                sbuf.append('+');
            } else {
                sbuf.append('%');
                String hex = Integer.toHexString((int) ch);
                if (hex.length() < 2) sbuf.append('0');
                sbuf.append(hex.toUpperCase());
            }
        }
        return sbuf.toString();
    }
}
