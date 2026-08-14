/**
 * Maps raw Python/runtime error strings to customer-readable messages.
 * Rules are checked in order — first match wins.
 */
const ERROR_RULES: Array<{ pattern: RegExp; message: string }> = [
  // Auth / credential failures
  { pattern: /401|unauthorized|invalid.*token|token.*invalid|authentication.*fail/i, message: "Authentication failed — please reconnect the relevant account in your Connectors page." },
  { pattern: /403|forbidden|permission.*denied|access.*denied/i, message: "Access denied — the connected account doesn't have permission to perform this action. Check the account's scopes." },

  // Rate limits
  { pattern: /429|rate.?limit|quota.*exceed|too many requests/i, message: "The external service is rate-limiting us. The agent will automatically retry in a moment." },

  // Connection / network
  { pattern: /timeout|timed.?out|connection.*reset|ECONNRESET|ETIMEDOUT/i, message: "The request timed out. This is usually temporary — try re-running the mission." },
  { pattern: /ENOTFOUND|getaddrinfo|network.*unreachable|connection.*refused/i, message: "Couldn't reach the external service. Check that the service is available and try again." },

  // Data / parsing errors (common Python runtime errors)
  { pattern: /NoneType.*has no attribute|AttributeError.*NoneType/i, message: "A previous step returned empty data, so this step had nothing to work with. Verify the data source is populated and connected." },
  { pattern: /AttributeError/i, message: "The data from a previous step was in an unexpected format. Check that the right connector is linked." },
  { pattern: /KeyError:\s*['"]?(\w+)/i, message: "A required field was missing from the data. The upstream step may not have returned the expected output." },
  { pattern: /IndexError|list index out of range/i, message: "Tried to access an item in an empty list. The previous step may have returned no results." },
  { pattern: /JSONDecodeError|json.*decode|Expecting value/i, message: "The service returned an unexpected response (not valid JSON). This may be a temporary issue — try again." },
  { pattern: /UnicodeDecodeError|codec.*can.*decode/i, message: "Encountered a character encoding issue in the response data. The file or text may need to be re-exported." },

  // Type errors
  { pattern: /TypeError.*unsupported operand/i, message: "Two incompatible data types were combined. Check that your inputs are in the expected format." },
  { pattern: /TypeError/i, message: "A step received data in the wrong format. Check your inputs or the previous step's output." },
  { pattern: /ValueError/i, message: "A value was invalid or out of the expected range. Double-check the inputs provided." },

  // File / IO
  { pattern: /FileNotFoundError|No such file/i, message: "A required file wasn't found. Make sure any uploaded files are attached correctly." },
  { pattern: /PermissionError.*file|IOError/i, message: "Couldn't read or write a file due to a permissions issue." },

  // Composio / tool-specific
  { pattern: /composio.*error|tool.*execution.*fail/i, message: "The tool action failed. Make sure the connected account has the necessary permissions and the service is available." },
  { pattern: /action.*not.*found|unknown.*action/i, message: "This action is not available for the connected account. Check that the right app is connected." },
  { pattern: /sandbox.*exit|e2b.*error|execution.*environment/i, message: "The code execution environment ran into a problem. The mission will retry automatically." },

  // LLM / model errors
  { pattern: /context.*length.*exceed|token.*limit|maximum.*token/i, message: "The input was too long for the AI model to process. Try breaking the task into smaller steps." },
  { pattern: /model.*overloaded|model.*unavailable|overloaded.*error/i, message: "The AI model is under heavy load right now. It will retry automatically." },

  // Generic fallback
  { pattern: /Exception|Error/i, message: "An unexpected error occurred. Our team has been notified — please try re-running the mission." },
];

export function humanizeError(raw: string): string {
  const str = String(raw).trim();
  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(str)) return rule.message;
  }
  // If nothing matched and it's short (probably already human-readable), return as-is
  if (str.length <= 120 && !/Traceback|File "\//.test(str)) return str;
  return "An unexpected error occurred. Please try re-running the mission.";
}
