// Custom multi-image uploader for the CloudCannon Visual Editor (Jekyll +
// Bookshop edition).
//
// CloudCannon's stock image input adds one file at a time. The
// <multi-image-uploader> element renders a floating "＋ Add images" pill in the
// corner of each Gallery block. Selecting/dropping several files uploads them
// all in one action and appends each to that block's `images` array, so the
// front matter grows and the grid fills in live.
//
// Two CloudCannon client APIs exist in the editor, and this uses BOTH — using
// the wrong one for the data write is what makes the grid silently not update:
//   1. window.CloudCannonAPI.useVersion("v1") — used here for uploadFile()
//      (pushes the bytes to the media library and returns a URL).
//   2. window.CloudCannon (the legacy API the Bookshop live editor is built on)
//      — this is what actually backs the page's front matter and live preview.
//      We append with CloudCannon.set(slug, newArray) and repaint with
//      CloudCannon.triggerUpdateEvent(). Writing the array via API #1 instead
//      leaves the front matter untouched — the upload "succeeds" but nothing
//      appears.
//
// The target array's data path (e.g. "content_blocks.1.images") is read from
// the `data-cms-bind` attribute CloudCannon puts on the component's root
// element in the editor (see resolveSlug).
//
// Loaded only inside the editor (see _layouts/default.html). Set
// `localStorage.miu-debug = "1"` and reload for verbose `[MIU]` tracing; errors
// always log.

(function () {
  "use strict";

  var DEBUG =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("miu-debug") === "1";
  function log() {
    if (!DEBUG) return;
    var args = ["[MIU]"].concat([].slice.call(arguments));
    console.log.apply(console, args);
  }
  function warn() {
    var args = ["[MIU]"].concat([].slice.call(arguments));
    console.warn.apply(console, args);
  }

  // window.CloudCannonAPI may not exist yet at parse time; fall back to the
  // cloudcannon:load event the editor fires once it is ready.
  function getApi() {
    if (window.CloudCannonAPI) {
      return Promise.resolve(window.CloudCannonAPI.useVersion("v1", true));
    }
    return new Promise(function (resolve) {
      document.addEventListener(
        "cloudcannon:load",
        function () {
          resolve(window.CloudCannonAPI.useVersion("v1", true));
        },
        { once: true },
      );
    });
  }

  var apiPromise = getApi();

  // Repaint the live preview after a data write. Bookshop's live-editing
  // connector (from @bookshop/generate) re-renders when a `cloudcannon:update`
  // event fires — its handler re-reads CloudCannon.value() and calls
  // bookshopLive.update() (throttled to ~1s). CloudCannon.triggerUpdateEvent()
  // is the editor's own way to fire that; call it once after the whole batch.
  function triggerLiveRerender() {
    var cc = window.CloudCannon;
    // The editor's own API exposes triggerUpdateEvent(); it fires the
    // `cloudcannon:update` the Bookshop live connector listens for. Fall back to
    // dispatching the event directly if the method isn't present.
    if (cc && typeof cc.triggerUpdateEvent === "function") {
      cc.triggerUpdateEvent();
      log("called CloudCannon.triggerUpdateEvent() → live re-render");
    } else {
      document.dispatchEvent(new CustomEvent("cloudcannon:update"));
      log("dispatched cloudcannon:update → live re-render");
    }
  }

  // Read a dotted data path (e.g. "content_blocks.1.images") out of a plain
  // front-matter object. Array indices work as string keys in JS.
  function getByPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc == null ? acc : acc[key];
    }, obj);
  }

  // Append items to the gallery's array through the LEGACY window.CloudCannon
  // API — the surface that actually backs this editor's front matter and live
  // preview (window.CloudCannonAPI.useVersion("v1") does NOT: its addArrayItem
  // left content_blocks[N].images unchanged). Read current array → append →
  // set the whole array back → trigger a re-render.
  function appendImages(slug, items) {
    var cc = window.CloudCannon;
    if (!cc || typeof cc.set !== "function" || typeof cc.value !== "function") {
      console.error("[MIU] window.CloudCannon.set/value unavailable; cannot append");
      return Promise.resolve(false);
    }
    return Promise.resolve(
      cc.value({ keepMarkdownAsHTML: false, preferBlobs: true }),
    ).then(function (data) {
      var current = getByPath(data, slug);
      var next = (Array.isArray(current) ? current : []).concat(items);
      log("CloudCannon.set", { slug: slug, from: current && current.length, to: next.length });
      return Promise.resolve(cc.set(slug, next)).then(function () {
        return true;
      });
    });
  }

  // Resolve the gallery's data path from CloudCannon's live-editing binding.
  // In the Visual Editor the component's root element carries a `data-cms-bind`
  // attribute holding the block's data path, e.g. `#content_blocks.1`. Strip the
  // leading `#` and append the array field → `content_blocks.1.images`.
  // (The static `<!--bookshop-live … -->` comments are rewritten by @bookshop/live
  // into a different, split form in the live DOM, so this attribute is the
  // reliable anchor.)
  function resolveSlug(startEl) {
    var bound = startEl.closest("[data-cms-bind]");
    var bind = bound && bound.getAttribute("data-cms-bind");
    if (!bind) {
      warn("could not resolve the gallery's data path (no [data-cms-bind])");
      return null;
    }
    return bind.replace(/^#/, "") + ".images";
  }

  function uploadAll(slug, fileList, onStatus) {
    var files = [].slice.call(fileList).filter(function (f) {
      return f.type.indexOf("image/") === 0;
    });
    if (!files.length) return Promise.resolve();

    return apiPromise.then(function (api) {
      var file = api.currentFile();

      // getInputConfig may return a Promise — it MUST be awaited to a plain
      // object before uploadFile(), which postMessages it to the parent window
      // (a pending Promise → DataCloneError and the upload silently never runs).
      function getInputConfig() {
        try {
          if (!file.getInputConfig) return Promise.resolve(undefined);
          return Promise.resolve(
            file.getInputConfig({ slug: slug + ".0.image" }),
          ).catch(function (e) {
            warn("getInputConfig failed (continuing without it):", e);
            return undefined;
          });
        } catch (e) {
          warn("getInputConfig threw (continuing without it):", e);
          return Promise.resolve(undefined);
        }
      }

      return getInputConfig().then(function (inputConfig) {
        var done = 0;
        var uploaded = [];
        onStatus("Uploading 0/" + files.length + "…");

        // Sequential upload: keeps append order deterministic. Items are
        // collected and written to the front matter in one set() at the end.
        return files
          .reduce(function (chain, f) {
            return chain.then(function () {
              return Promise.resolve(api.uploadFile(f, inputConfig))
                .then(function (url) {
                  log("uploaded", { file: f.name, url });
                  uploaded.push({ image: url, image_alt: "" });
                  done++;
                })
                .catch(function (err) {
                  console.error("[MIU] upload failed:", f.name, err);
                })
                .then(function () {
                  onStatus("Uploading " + done + "/" + files.length + "…");
                });
            });
          }, Promise.resolve())
          .then(function () {
            if (uploaded.length) return appendImages(slug, uploaded);
          })
          .then(function () {
            if (done > 0) triggerLiveRerender();
            onStatus(
              done === files.length
                ? "Added " + done + " image" + (done === 1 ? "" : "s") + "."
                : "Added " + done + " of " + files.length + " (see console).",
            );
          });
      });
    });
  }

  class MultiImageUploader extends HTMLElement {
    connectedCallback() {
      // Render into shadow DOM, not light DOM. Bookshop's live engine re-renders
      // the component region by replacing its light-DOM markup — which would
      // strip a light-DOM dropzone, leaving a sized-but-blank (invisible)
      // element. A shadow root is invisible to that repaint, so the pill
      // survives. attachShadow throws if called twice, so guard on the root.
      if (this.shadowRoot) return;
      this.render();
    }

    render() {
      var root = this.attachShadow({ mode: "open" });
      root.innerHTML =
        '<style>' +
        ".miu-zone{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .85rem;" +
        "border-radius:999px;border:1px solid #c7cdd6;background:rgba(255,255,255,.95);" +
        "box-shadow:0 2px 8px rgba(15,23,42,.15);color:#1e293b;font:600 .85rem/1 system-ui,sans-serif;" +
        "white-space:nowrap;cursor:pointer;backdrop-filter:blur(4px);" +
        "transition:border-color .15s,background .15s,box-shadow .15s}" +
        ".miu-zone:hover{box-shadow:0 3px 12px rgba(15,23,42,.22)}" +
        '.miu-zone[data-drag="true"]{border-color:#2563eb;background:#eff6ff;color:#1d4ed8}' +
        ".miu-icon{font-size:1.05rem;line-height:1}" +
        ".miu-status{margin-top:.35rem;padding:.2rem .55rem;border-radius:.4rem;" +
        "background:rgba(255,255,255,.95);box-shadow:0 2px 8px rgba(15,23,42,.15);" +
        "font:500 .78rem/1.3 system-ui,sans-serif;color:#2563eb;text-align:right}" +
        ".miu-status[hidden]{display:none}" +
        "input{display:none}" +
        "</style>" +
        '<label class="miu-zone" title="Upload multiple images at once">' +
        '<span class="miu-icon">＋</span><span>Add images</span>' +
        '<input type="file" accept="image/*" multiple /></label>' +
        '<div class="miu-status" hidden></div>';

      var zone = root.querySelector(".miu-zone");
      var input = root.querySelector("input");
      this.statusEl = root.querySelector(".miu-status");
      var self = this;

      input.addEventListener("change", function () {
        if (input.files && input.files.length) self.upload(input.files);
        input.value = "";
      });

      function setDrag(on) {
        zone.setAttribute("data-drag", String(on));
      }
      ["dragenter", "dragover"].forEach(function (evt) {
        zone.addEventListener(evt, function (e) {
          e.preventDefault();
          setDrag(true);
        });
      });
      ["dragleave", "dragend"].forEach(function (evt) {
        zone.addEventListener(evt, function () {
          setDrag(false);
        });
      });
      zone.addEventListener("drop", function (e) {
        e.preventDefault();
        setDrag(false);
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) self.upload(files);
      });
    }

    upload(files) {
      var slug = resolveSlug(this);
      log("upload starting", {
        files: [].slice.call(files).map(function (f) {
          return f.name;
        }),
        resolvedSlug: slug,
      });
      if (!slug) return;

      var self = this;
      uploadAll(slug, files, function (t) {
        if (!self.statusEl) return;
        self.statusEl.textContent = t;
        self.statusEl.hidden = false;
        // Auto-dismiss the floating pill's status once a batch finishes.
        if (/\.$/.test(t)) {
          var el = self.statusEl;
          setTimeout(function () {
            if (el.textContent === t) el.hidden = true;
          }, 4000);
        }
      });
    }
  }

  if (!customElements.get("multi-image-uploader")) {
    customElements.define("multi-image-uploader", MultiImageUploader);
  }
})();
