package whatsapp;

import java.util.Vector;
import javax.microedition.lcdui.*;
import javax.microedition.midlet.MIDlet;

public class WhatsAppMIDlet extends MIDlet implements CommandListener {

    private Display display;

    // Config
    private String serverUrl = "http://192.168.1.10:8080";
    private String myPhone = "";

    // Navigation Screens
    private Form settingsForm;
    private TextField urlField;
    private TextField phoneField;

    private Form pairForm;
    private StringItem pairCodeItem;
    private StringItem pairHelpItem;

    private List chatList;
    private Vector chatJids = new Vector();
    private Vector chatNames = new Vector();

    private Form messageForm;
    private String currentChatJid = "";
    private String currentChatName = "";

    private TextBox composeBox;

    private List contactsList;
    private Vector contactJids = new Vector();

    private Form newChatForm;
    private TextField newPhoneField;

    // Commands
    private Command cmdOk = new Command("OK", Command.OK, 1);
    private Command cmdBack = new Command("Back", Command.BACK, 2);
    private Command cmdRefresh = new Command("Refresh", Command.ITEM, 3);
    private Command cmdReply = new Command("Reply", Command.SCREEN, 1);
    private Command cmdSend = new Command("Send", Command.OK, 1);
    private Command cmdSettings = new Command("Settings", Command.SCREEN, 5);
    private Command cmdNewChat = new Command("New Chat", Command.SCREEN, 2);
    private Command cmdContacts = new Command("Contacts", Command.SCREEN, 3);
    private Command cmdExit = new Command("Exit", Command.EXIT, 6);
    private Command cmdCancel = new Command("Cancel", Command.CANCEL, 2);
    private Command cmdPair = new Command("Get Code", Command.ITEM, 1);

    protected void startApp() {
        display = Display.getDisplay(this);

        // Load saved RMS config
        String[] cfg = RMSManager.loadConfig();
        serverUrl = cfg[0];
        myPhone = cfg[1];

        if (serverUrl == null || serverUrl.trim().length() == 0 || serverUrl.indexOf("http") == -1) {
            showSettingsScreen();
        } else {
            checkStatusAndProceed();
        }
    }

    protected void pauseApp() {}

    protected void destroyApp(boolean unconditional) {}

    // ── Navigation & Screens ──────────────────────────────────────────────────

    private void showSettingsScreen() {
        settingsForm = new Form("WhatsApp Settings");
        urlField = new TextField("Bridge Server URL:", serverUrl, 120, TextField.URL);
        phoneField = new TextField("My Phone (digits only):", myPhone, 20, TextField.PHONENUMBER);

        settingsForm.append(urlField);
        settingsForm.append(phoneField);
        settingsForm.append(new StringItem("Help:", "Enter Railway/Fly server URL & your phone number with country code."));

        settingsForm.addCommand(cmdOk);
        settingsForm.addCommand(cmdExit);
        settingsForm.setCommandListener(this);

        display.setCurrent(settingsForm);
    }

    private void checkStatusAndProceed() {
        showLoading("Connecting to bridge...");
        HttpHelper.getAsync(serverUrl + "/status", new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        String st = response.trim();
                        if ("LINKED".equals(st)) {
                            loadChats();
                        } else {
                            showPairingScreen();
                        }
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        showAlert("Connection Error", "Cannot reach bridge:\n" + error, settingsForm != null ? settingsForm : null);
                        showSettingsScreen();
                    }
                });
            }
        });
    }

    private void showPairingScreen() {
        pairForm = new Form("Link WhatsApp");
        pairCodeItem = new StringItem("Pairing Code:", "Press 'Get Code' below");
        pairHelpItem = new StringItem("Instructions:", 
            "1. Enter your phone number in Settings.\n" +
            "2. Press 'Get Code'.\n" +
            "3. On your Android/iPhone WhatsApp:\n" +
            "   Settings -> Linked Devices -> Link with phone number -> Enter this code.");

        pairForm.append(pairCodeItem);
        pairForm.append(pairHelpItem);

        pairForm.addCommand(cmdPair);
        pairForm.addCommand(cmdRefresh);
        pairForm.addCommand(cmdSettings);
        pairForm.addCommand(cmdExit);
        pairForm.setCommandListener(this);

        display.setCurrent(pairForm);
    }

    private void requestPairingCode() {
        if (myPhone == null || myPhone.trim().length() < 7) {
            showAlert("Phone Missing", "Please set your phone number in Settings first.", pairForm);
            return;
        }

        showLoading("Requesting Pairing Code...");
        String url = serverUrl + "/pair?phone=" + StringUtil.urlEncode(myPhone.trim());
        HttpHelper.getAsync(url, new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        display.setCurrent(pairForm);
                        if (response.indexOf("CODE:") != -1) {
                            String code = response.substring(response.indexOf("CODE:") + 5).trim();
                            pairCodeItem.setText("\n>> " + code + " <<\n");
                        } else if ("ALREADY_LINKED".equals(response.trim())) {
                            loadChats();
                        } else {
                            pairCodeItem.setText(response);
                        }
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        display.setCurrent(pairForm);
                        pairCodeItem.setText("Error: " + error);
                    }
                });
            }
        });
    }

    // ── Chat List ─────────────────────────────────────────────────────────────

    private void loadChats() {
        showLoading("Loading Chats...");
        HttpHelper.getAsync(serverUrl + "/chats", new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        populateChatList(response);
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        showAlert("Error", "Failed to load chats: " + error, chatList != null ? chatList : null);
                    }
                });
            }
        });
    }

    private void populateChatList(String raw) {
        chatList = new List("WhatsApp Chats", List.IMPLICIT);
        chatJids.removeAllElements();
        chatNames.removeAllElements();

        if (raw == null || raw.trim().equals("EMPTY") || raw.trim().length() == 0) {
            chatList.append("(No active conversations)", null);
        } else {
            String[] lines = StringUtil.split(raw.trim(), '\n');
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i].trim();
                if (line.length() == 0) continue;
                String[] parts = StringUtil.split(line, '|');
                if (parts.length >= 3) {
                    String jid = parts[0];
                    String name = parts[1];
                    String lastMsg = parts[2];
                    String time = (parts.length >= 4) ? parts[3] : "";

                    chatJids.addElement(jid);
                    chatNames.addElement(name);

                    String displayStr = name + " [" + time + "]\n" + (lastMsg.length() > 30 ? lastMsg.substring(0, 27) + "..." : lastMsg);
                    chatList.append(displayStr, null);
                }
            }
        }

        chatList.addCommand(cmdNewChat);
        chatList.addCommand(cmdContacts);
        chatList.addCommand(cmdRefresh);
        chatList.addCommand(cmdSettings);
        chatList.addCommand(cmdExit);
        chatList.setCommandListener(this);

        display.setCurrent(chatList);
    }

    // ── Conversation Messages ─────────────────────────────────────────────────

    private void openConversation(String jid, String name) {
        currentChatJid = jid;
        currentChatName = name;
        loadMessages(jid, name);
    }

    private void loadMessages(final String jid, final String name) {
        showLoading("Loading messages...");
        HttpHelper.getAsync(serverUrl + "/messages?jid=" + StringUtil.urlEncode(jid), new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        displayMessages(name, response);
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        showAlert("Error", "Could not load messages: " + error, chatList);
                    }
                });
            }
        });
    }

    private void displayMessages(String name, String raw) {
        messageForm = new Form(name);

        if (raw == null || raw.trim().equals("EMPTY") || raw.trim().length() == 0) {
            messageForm.append(new StringItem("", "(No messages in this chat yet)"));
        } else {
            String[] lines = StringUtil.split(raw.trim(), '\n');
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i].trim();
                if (line.length() == 0) continue;
                String[] parts = StringUtil.split(line, '|');
                if (parts.length >= 2) {
                    String sender = parts[0];
                    String text = parts[1];
                    String time = (parts.length >= 5) ? parts[4] : "";
                    String participant = (parts.length >= 6) ? parts[5] : "";

                    String header;
                    if ("ME".equals(sender)) {
                        header = "[Me " + time + "]:";
                    } else {
                        header = "[" + (participant.length() > 0 ? participant : name) + " " + time + "]:";
                    }

                    StringItem msgItem = new StringItem(header, " " + text + "\n");
                    messageForm.append(msgItem);
                }
            }
        }

        messageForm.addCommand(cmdReply);
        messageForm.addCommand(cmdRefresh);
        messageForm.addCommand(cmdBack);
        messageForm.setCommandListener(this);

        display.setCurrent(messageForm);
    }

    // ── Compose & Send ────────────────────────────────────────────────────────

    private void showComposeBox() {
        composeBox = new TextBox("Send to " + currentChatName, "", 300, TextField.ANY);
        composeBox.addCommand(cmdSend);
        composeBox.addCommand(cmdCancel);
        composeBox.setCommandListener(this);
        display.setCurrent(composeBox);
    }

    private void sendMessage(final String text) {
        if (text == null || text.trim().length() == 0) return;
        showLoading("Sending...");

        String postBody = "jid=" + StringUtil.urlEncode(currentChatJid) +
                          "&message=" + StringUtil.urlEncode(text.trim());

        HttpHelper.postAsync(serverUrl + "/send", postBody, new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        loadMessages(currentChatJid, currentChatName);
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        showAlert("Failed", "Message failed to send:\n" + error, messageForm);
                    }
                });
            }
        });
    }

    // ── Contacts & New Chat ───────────────────────────────────────────────────

    private void showContacts() {
        showLoading("Loading contacts...");
        HttpHelper.getAsync(serverUrl + "/contacts", new HttpHelper.HttpCallback() {
            public void onSuccess(final String response) {
                display.callSerially(new Runnable() {
                    public void run() {
                        contactsList = new List("Contacts", List.IMPLICIT);
                        contactJids.removeAllElements();
                        if (response.trim().equals("EMPTY") || response.trim().length() == 0) {
                            contactsList.append("(No contacts synced yet)", null);
                        } else {
                            String[] lines = StringUtil.split(response.trim(), '\n');
                            for (int i = 0; i < lines.length; i++) {
                                String[] p = StringUtil.split(lines[i], '|');
                                if (p.length >= 2) {
                                    contactJids.addElement(p[0]);
                                    contactsList.append(p[1] + " (" + (p.length >= 3 ? p[2] : "") + ")", null);
                                }
                            }
                        }
                        contactsList.addCommand(cmdBack);
                        contactsList.setCommandListener(WhatsAppMIDlet.this);
                        display.setCurrent(contactsList);
                    }
                });
            }
            public void onError(final String error) {
                display.callSerially(new Runnable() {
                    public void run() {
                        showAlert("Error", "Could not fetch contacts: " + error, chatList);
                    }
                });
            }
        });
    }

    private void showNewChatForm() {
        newChatForm = new Form("Start New Chat");
        newPhoneField = new TextField("Phone Number (with Country Code):", "", 20, TextField.PHONENUMBER);
        newChatForm.append(newPhoneField);
        newChatForm.append(new StringItem("Example:", "919876543210 (India)"));

        newChatForm.addCommand(cmdOk);
        newChatForm.addCommand(cmdBack);
        newChatForm.setCommandListener(this);
        display.setCurrent(newChatForm);
    }

    // ── Command Handling ──────────────────────────────────────────────────────

    public void commandAction(Command c, Displayable d) {
        if (c == cmdExit) {
            destroyApp(true);
            notifyDestroyed();
            return;
        }

        // Settings Form Actions
        if (d == settingsForm && c == cmdOk) {
            serverUrl = urlField.getString().trim();
            myPhone = phoneField.getString().trim();
            // Remove trailing slash
            if (serverUrl.endsWith("/")) {
                serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
            }
            RMSManager.saveConfig(serverUrl, myPhone);
            checkStatusAndProceed();
            return;
        }

        // Pairing Form Actions
        if (d == pairForm) {
            if (c == cmdPair) {
                requestPairingCode();
            } else if (c == cmdRefresh) {
                checkStatusAndProceed();
            } else if (c == cmdSettings) {
                showSettingsScreen();
            }
            return;
        }

        // Chat List Actions
        if (d == chatList) {
            if (c == List.SELECT_COMMAND) {
                int index = chatList.getSelectedIndex();
                if (index >= 0 && index < chatJids.size()) {
                    String jid = (String) chatJids.elementAt(index);
                    String name = (String) chatNames.elementAt(index);
                    openConversation(jid, name);
                }
            } else if (c == cmdRefresh) {
                loadChats();
            } else if (c == cmdNewChat) {
                showNewChatForm();
            } else if (c == cmdContacts) {
                showContacts();
            } else if (c == cmdSettings) {
                showSettingsScreen();
            }
            return;
        }

        // Message View Actions
        if (d == messageForm) {
            if (c == cmdReply) {
                showComposeBox();
            } else if (c == cmdRefresh) {
                loadMessages(currentChatJid, currentChatName);
            } else if (c == cmdBack) {
                display.setCurrent(chatList);
            }
            return;
        }

        // Compose Box Actions
        if (d == composeBox) {
            if (c == cmdSend) {
                sendMessage(composeBox.getString());
            } else if (c == cmdCancel) {
                display.setCurrent(messageForm);
            }
            return;
        }

        // Contacts List Actions
        if (d == contactsList) {
            if (c == List.SELECT_COMMAND) {
                int idx = contactsList.getSelectedIndex();
                if (idx >= 0 && idx < contactJids.size()) {
                    String jid = (String) contactJids.elementAt(idx);
                    String name = contactsList.getString(idx);
                    openConversation(jid, name);
                }
            } else if (c == cmdBack) {
                display.setCurrent(chatList);
            }
            return;
        }

        // New Chat Form Actions
        if (d == newChatForm) {
            if (c == cmdOk) {
                String p = newPhoneField.getString().trim();
                if (p.length() >= 7) {
                    String jid = p + "@s.whatsapp.net";
                    openConversation(jid, "+" + p);
                } else {
                    showAlert("Invalid", "Please enter a valid phone number.", newChatForm);
                }
            } else if (c == cmdBack) {
                display.setCurrent(chatList);
            }
            return;
        }
    }

    // ── Alerts & Loading ──────────────────────────────────────────────────────

    private void showLoading(String msg) {
        Form loading = new Form("WhatsApp");
        loading.append(new StringItem("", msg));
        display.setCurrent(loading);
    }

    private void showAlert(String title, String msg, Displayable next) {
        Alert alert = new Alert(title, msg, null, AlertType.INFO);
        alert.setTimeout(3500);
        if (next != null) {
            display.setCurrent(alert, next);
        } else {
            display.setCurrent(alert);
        }
    }
}
