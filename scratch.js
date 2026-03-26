const line = "- `T-001` AX task";
const regex = /^- `([^`]+)`\s+(.+)$/;
console.log(regex.exec(line));
