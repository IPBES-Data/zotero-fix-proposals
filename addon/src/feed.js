/* global Zotero, FixProposals, Services, Ci, IOUtils, PathUtils */

// Reading the proposals feed: index.json and one file per group, from the URL
// in the settings (http(s), or file: for tests).
FixProposals.feed = {
  // web address (http, https), file: address or a local folder
  url() {
    var u = String(Zotero.Prefs.get("extensions.fix-proposals.feedURL", true) || "").trim();
    if (!/^[a-z]+:/i.test(u) || /^[a-z]:\\/i.test(u)) {
      // a folder: /path, ~/path or C:\path
      if (u.startsWith("~")) u = PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, u.slice(1).replace(/^[\/\\]/, ""));
      u = PathUtils.toFileURI(u);
    }
    return u.endsWith("/") ? u : u + "/";
  },

  async _json(url) {
    if (url.startsWith("file:")) {
      var path = Services.io.newURI(url).QueryInterface(Ci.nsIFileURL).file.path;
      return JSON.parse(await IOUtils.readUTF8(path));
    }
    var xhr = await Zotero.HTTP.request("GET", url, {
      responseType: "json",
      headers: { "Cache-Control": "no-cache" },
      timeout: 60000,
    });
    return xhr.response;
  },

  // {format, version, created, groups: [{group_id, name, file}]}
  async index() {
    var data = await this._json(this.url() + "index.json");
    if (!data || data.format !== "zotero-fix-proposals-index") {
      throw new Error("No proposals index at " + this.url());
    }
    return data;
  },

  // the proposals of a group, checked
  async group(entry) {
    var data = await this._json(this.url() + entry.file);
    var problems = FixProposals.logic.checkFile(data);
    if (problems.length) {
      throw new Error("Proposals of " + entry.name + ": " + problems.join("; "));
    }
    return data;
  },
};
