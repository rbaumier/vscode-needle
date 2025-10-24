const { fuzzySearch } = require("./rust-fuzzy");

const lines = ["parse function", "other content"];
const results = fuzzySearch(lines, "prse", 10);

console.log("Results:", JSON.stringify(results, null, 2));
console.log("Type:", typeof results);
console.log("Is array:", Array.isArray(results));
if (results.length > 0) {
  console.log("First result:", results[0]);
  console.log("First result type:", typeof results[0]);
}
