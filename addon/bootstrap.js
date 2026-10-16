/* global Zotero, Services, Cc, Ci */

// Zotero Fix Proposals: a window which shows fixes proposed for Zotero groups
// (read from a published proposals feed) and applies the ones the user
// chooses through Zotero Safe Edit, which checks, asks for approval, writes
// and logs. This plugin never writes to Zotero items itself.

var FixProposals;
var chromeHandle;
var MODULES = ["logic", "feed"];
var MENU_ID = "fix-proposals-menuitem";

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup
  );
  chromeHandle = aomStartup.registerChrome(
    Services.io.newURI(rootURI + "manifest.json"),
    [["content", "fix-proposals", rootURI + "content/"]]
  );
  var win = Zotero.getMainWindow();
  FixProposals = { id, version, rootURI };
  for (let name of MODULES) {
    Services.scriptloader.loadSubScript(rootURI + "src/" + name + ".js", {
      Zotero,
      FixProposals,
      Services,
      Cc,
      Ci,
      IOUtils: win.IOUtils,
      PathUtils: win.PathUtils,
    });
  }
  FixProposals.openWindow = () => {
    var existing = Services.wm.getMostRecentWindow("zotero:fix-proposals");
    if (existing) {
      existing.focus();
      return existing;
    }
    return Zotero.getMainWindow().openDialog(
      "chrome://fix-proposals/content/fixes.xhtml",
      "fix-proposals",
      "chrome,resizable,centerscreen,dialog=no,width=1200,height=850"
    );
  };
  Zotero.FixProposals = FixProposals;

  for (let w of Zotero.getMainWindows()) addMenu(w);

  await Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "content/prefs.xhtml",
    label: "Fix Proposals",
  });
}

function onMainWindowLoad({ window }) {
  addMenu(window);
}

function onMainWindowUnload({ window }) {
  window.document.getElementById(MENU_ID)?.remove();
}

// Tools → Fix Proposals…
function addMenu(win) {
  var doc = win.document;
  if (doc.getElementById(MENU_ID)) return;
  var item = doc.createXULElement("menuitem");
  item.id = MENU_ID;
  item.setAttribute("label", "Fix Proposals…");
  item.addEventListener("command", () => FixProposals.openWindow());
  doc.getElementById("menu_ToolsPopup")?.appendChild(item);
}

function shutdown() {
  for (let w of Zotero.getMainWindows()) w.document.getElementById(MENU_ID)?.remove();
  Services.wm.getMostRecentWindow("zotero:fix-proposals")?.close();
  delete Zotero.FixProposals;
  FixProposals = undefined;
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}
