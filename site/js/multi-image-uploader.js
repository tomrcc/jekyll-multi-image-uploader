// Custom multi-image uploader for the CloudCannon Visual Editor (Jekyll +
// Bookshop edition).
//
// CloudCannon's stock image input adds one file at a time. The
// <multi-image-uploader> element renders a floating "＋ Add images" pill in the
// corner of each Gallery block. Selecting/dropping several files uploads them
// all in one action and appends each to that block's `images` array, so the
// grid fills in live.
//
// How the Bookshop edition differs from the Astro/Editable-Regions edition:
//   - Live re-rendering is driven by @bookshop/live, which re-renders a
//     component region whenever its underlying DATA changes. So we call the
//     raw `currentFile().data.addArrayItem({ slug, value })` API directly and
//     Bookshop repaints — no bubbling `cloudcannon-api` event needed (that is
//     an Editable-Regions-only mechanism, absent here).
//   - There are no `data-editable`/`data-prop` attributes to walk. Instead the
//     component's data path lives in a `<!--bookshop-live … context(block=
//     content_blocks[N]) -->` comment that wraps the region. We parse N from it.
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

  // Resolve the gallery's data path from the Bookshop live-editing comment that
  // wraps this component, e.g. `<!--bookshop-live name(gallery/gallery.jekyll.html)
  // … context(block=content_blocks[2]) -->` → `content_blocks[2].images`.
  //
  // Walk up the DOM; at each level scan preceding sibling nodes for that comment.
  function resolveSlug(startEl) {
    var node = startEl;
    while (node) {
      var sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 8 /* COMMENT_NODE */) {
          var text = sib.textContent || "";
          if (/name\(gallery\//.test(text)) {
            var m = text.match(/content_blocks\[(\d+)\]/);
            if (m) return "content_blocks[" + m[1] + "].images";
          }
        }
        sib = sib.previousSibling;
      }
      node = node.parentNode;
    }
    warn("could not resolve the gallery's data path from bookshop-live comments");
    return null;
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
        onStatus("Uploading 0/" + files.length + "…");

        // Sequential: keeps append order deterministic and avoids racing the
        // re-render Bookshop fires on each data write.
        return files
          .reduce(function (chain, f) {
            return chain.then(function () {
              return Promise.resolve(api.uploadFile(f, inputConfig))
                .then(function (url) {
                  var value = { image: url, image_alt: "" };
                  log("uploaded → addArrayItem", { file: f.name, url, slug });
                  // Raw API: Bookshop's live engine re-renders on data change.
                  return file.data.addArrayItem({ slug: slug, value: value });
                })
                .then(function () {
                  done++;
                })
                .catch(function (err) {
                  console.error("[MIU] upload/append failed:", f.name, err);
                })
                .then(function () {
                  onStatus("Uploading " + done + "/" + files.length + "…");
                });
            });
          }, Promise.resolve())
          .then(function () {
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
