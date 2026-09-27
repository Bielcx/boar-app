// app.json holds the shared config; this only layers the Android build
// variant on top (plugins/withBuildVariant.js, docs/BUILD_VARIANTS.md).
const { applyBuildVariant } = require("./plugins/withBuildVariant");

module.exports = ({ config }) => applyBuildVariant(config);
