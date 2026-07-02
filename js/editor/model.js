/* ─── MODEL ──────────────────────────────────────────────────────
   The text model owns the plain-text representation of the document.
   It stores the document as an array of blocks (one per line).
   The Markdown engine and Renderer never touch this directly —
   they receive copies and return transforms. */

function TextModel(text) {
  this.blocks = (text || "").split("\n");
}

TextModel.prototype.getText = function () {
  return this.blocks.join("\n");
};

TextModel.prototype.getBlock = function (index) {
  return this.blocks[index] || "";
};

TextModel.prototype.setBlock = function (index, text) {
  this.blocks[index] = text;
};

TextModel.prototype.insertBlock = function (index, text) {
  this.blocks.splice(index, 0, text);
};

TextModel.prototype.deleteBlock = function (index) {
  this.blocks.splice(index, 1);
};

TextModel.prototype.blockCount = function () {
  return this.blocks.length;
};
