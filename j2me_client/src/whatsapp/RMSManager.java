package whatsapp;

import javax.microedition.rms.RecordStore;

/**
 * Handles persistent settings storage on Nokia phones using RMS (RecordStore).
 */
public class RMSManager {
    private static final String RS_NAME = "wa_settings";

    public static void saveConfig(String serverUrl, String phone) {
        RecordStore rs = null;
        try {
            RecordStore.deleteRecordStore(RS_NAME);
        } catch (Exception e) {}

        try {
            rs = RecordStore.openRecordStore(RS_NAME, true);
            byte[] dataUrl = (serverUrl != null ? serverUrl : "").getBytes();
            rs.addRecord(dataUrl, 0, dataUrl.length);

            byte[] dataPhone = (phone != null ? phone : "").getBytes();
            rs.addRecord(dataPhone, 0, dataPhone.length);
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (rs != null) {
                try { rs.closeRecordStore(); } catch (Exception e) {}
            }
        }
    }

    public static String[] loadConfig() {
        RecordStore rs = null;
        String[] config = new String[]{"http://192.168.1.10:8080", ""};
        try {
            rs = RecordStore.openRecordStore(RS_NAME, false);
            if (rs.getNumRecords() >= 1) {
                byte[] b1 = rs.getRecord(1);
                config[0] = new String(b1);
            }
            if (rs.getNumRecords() >= 2) {
                byte[] b2 = rs.getRecord(2);
                config[1] = new String(b2);
            }
        } catch (Exception e) {
            // No saved config yet, use defaults
        } finally {
            if (rs != null) {
                try { rs.closeRecordStore(); } catch (Exception e) {}
            }
        }
        return config;
    }
}
