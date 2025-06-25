// test/content.utility.test.js

// Duplicated from content.js for testing purposes
function isValidUsername(username) {
  if (!username) {
    return false;
  }
  const githubUsernameRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  if (username.length > 39) {
      return false;
  }
  return githubUsernameRegex.test(username);
}

const KNOWN_BOT_PATTERNS_TEST = [
    "bot", "copilot", "dependabot", "github-actions",
    "renovate", "snyk-bot", "codecov-commenter",
    "greenkeeper", "netlify", "vercel",
];

function isBotUsername(username, knownPatterns) {
  if (!username) return false;
  const lowerUsername = username.toLowerCase();

  for (const pattern of knownPatterns) {
    if (lowerUsername.includes(pattern)) {
      if (lowerUsername === pattern || lowerUsername.endsWith(`[${pattern}]`) || lowerUsername.endsWith(`-${pattern}`) || lowerUsername.startsWith(`${pattern}-`)) {
        return true;
      }
      if (pattern === "bot" && (lowerUsername.endsWith("[bot]") || lowerUsername.endsWith("-bot"))) {
        return true;
      }
    }
  }
  if (lowerUsername.endsWith("[bot]") || lowerUsername.endsWith("-bot") || lowerUsername.startsWith("bot-")) {
      return true;
  }
  return false;
}

// --- Tests Start Here ---
describe('isValidUsername', () => {
  // Valid usernames
  test('should return true for valid usernames', () => {
    expect(isValidUsername('jules-engineer')).toBe(true);
    expect(isValidUsername('user123')).toBe(true);
    expect(isValidUsername('u-s-e-r')).toBe(true);
    expect(isValidUsername('a')).toBe(true);
    expect(isValidUsername('1')).toBe(true);
    expect(isValidUsername('a1-b2-c3')).toBe(true);
    expect(isValidUsername('maxlengthusernameisexactly39charslong')).toBe(true); // 39 chars
  });

  // Invalid usernames: null, empty, too long
  test('should return false for null or empty usernames', () => {
    expect(isValidUsername(null)).toBe(false);
    expect(isValidUsername('')).toBe(false);
  });

  test('should return false for usernames that are too long', () => {
    expect(isValidUsername('thisusernameiswaytoolongandshouldfailvalidation')).toBe(false); // > 39 chars
  });

  // Invalid usernames: starting/ending with hyphen, consecutive hyphens
  test('should return false for usernames starting or ending with a hyphen', () => {
    expect(isValidUsername('-invalid')).toBe(false);
    expect(isValidUsername('invalid-')).toBe(false);
  });

  test('should return false for usernames with consecutive hyphens', () => {
    expect(isValidUsername('invalid--username')).toBe(false);
  });

  // Invalid usernames: special characters, spaces
  test('should return false for usernames with invalid characters', () => {
    expect(isValidUsername('invalid username')).toBe(false); // space
    expect(isValidUsername('invalid@username')).toBe(false); // @
    expect(isValidUsername('invalid!username')).toBe(false); // !
    expect(isValidUsername('invalid_username')).toBe(false); // _
    expect(isValidUsername('Change `suppressInlineSuggestions` to be a string (and thus exp controllable) (#252351)')).toBe(false);
  });

  test('should return false for path-like strings', () => {
    expect(isValidUsername('users/login')).toBe(false);
    expect(isValidUsername('login/oauth/authorize')).toBe(false);
  });
});

describe('isBotUsername', () => {
  test('should return true for known bot names and patterns', () => {
    expect(isBotUsername('Copilot', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('copilot', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('dependabot[bot]', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('github-actions[bot]', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('renovate-bot', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('some-bot', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('bot-experimental', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
    expect(isBotUsername('netlify[bot]', KNOWN_BOT_PATTERNS_TEST)).toBe(true);
  });

  test('should return false for regular usernames', () => {
    expect(isBotUsername('jules-engineer', KNOWN_BOT_PATTERNS_TEST)).toBe(false);
    expect(isBotUsername('notabot', KNOWN_BOT_PATTERNS_TEST)).toBe(false);
    expect(isBotUsername('someuserbotnotreally', KNOWN_BOT_PATTERNS_TEST)).toBe(false);
  });

  test('should correctly identify bot if only "bot" is in KNOWN_BOT_PATTERNS_TEST and username ends with [bot] or -bot', () => {
    const onlyBotPattern = ["bot"];
    expect(isBotUsername('my-special-bot', onlyBotPattern)).toBe(true);
    expect(isBotUsername('another[bot]', onlyBotPattern)).toBe(true);
    expect(isBotUsername('bot-leader', onlyBotPattern)).toBe(true);
    expect(isBotUsername('robot', onlyBotPattern)).toBe(false);
  });

  test('should return false for null or empty usernames', () => {
    expect(isBotUsername(null, KNOWN_BOT_PATTERNS_TEST)).toBe(false);
    expect(isBotUsername('', KNOWN_BOT_PATTERNS_TEST)).toBe(false);
  });
});

describe('HTML Snippet Problem Handling', () => {
  test('should identify invalid alt text from the first example', () => {
    const altText = "@Change suppressInlineSuggestions to be a string (and thus exp controllable) (#252351)";
    const extractedUsername = altText.replace("@", "").trim();
    expect(isValidUsername(extractedUsername)).toBe(false);
  });

  test('should identify "Copilot" as a bot from the second example alt text', () => {
    const altText = "Copilot";
    const extractedUsername = altText.replace("@", "").trim();
    expect(isValidUsername(extractedUsername)).toBe(true);
    expect(isBotUsername(extractedUsername, KNOWN_BOT_PATTERNS_TEST)).toBe(true);
  });
});

// --- Tests for getUsername ---

// Duplicated/adapted from content.js for testing getUsername
function getUsername_testable(anchorElement) { // anchorElement is a mock DOM element
  // isValidUsername is already defined in this test file

  let usernameStr = null;
  const hover = anchorElement.getAttribute("data-hovercard-url");
  const href = anchorElement.getAttribute("href");

  if (hover) {
    // Regex from content.js (after fix for hovercard)
    const match = hover.match(/^\/users\/([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])*)(?:[\/?#]|$)/);
    if (match) usernameStr = match[1];
  }

  if (!usernameStr && href) {
    // Updated regex to match content.js (more comprehensive for href)
    const match = href.match(/^\/([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])*)(?:$|\?(?:[^#]*|$)|#(?:.*|$)|(?:\/(?:issues|pulls|projects|commits))(?:$|\?(?:[^#]*|$)|#(?:.*|$)))/);
    const blacklist = /^(orgs|sponsors|marketplace|topics|collections|explore|trending|events|codespaces|settings|notifications|logout|features|pricing|readme|about|contact|site|security|open-source|customer-stories|team|enterprise|careers|blog|search|new|import|organizations|dashboard|stars|watching|profile|account|gist|integrations|apps|developer|sitemap|robots\.txt|humans\.txt|favicon\.ico|apple-touch-icon\.png|manifest\.json|login|join|session|sessions|auth|api|graphql|raw|blob|tree|releases|wiki|pulse|graphs|network|community|actions|packages|discussions|sponsors)$/i;
    if (match && match[1] && !blacklist.test(match[1])) {
      usernameStr = match[1];
    }
  }

  if (usernameStr && isValidUsername(usernameStr)) { // isValidUsername is from earlier in this test file
    if (usernameStr.toLowerCase().includes("[bot]")) { // Check for "[bot]"
      return null;
    }
    return usernameStr;
  }
  return null;
}

describe('getUsername_testable', () => {
  const createMockAnchor = ({ href, hovercardUrl }) => {
    // JSDOM environment is provided by Jest config
    const anchor = document.createElement('a');
    if (href) anchor.setAttribute('href', href);
    if (hovercardUrl) anchor.setAttribute('data-hovercard-url', hovercardUrl);
    return anchor;
  };

  test('should extract username from data-hovercard-url (e.g., /users/RedRecondite/hovercard)', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/RedRecondite/hovercard' });
    expect(getUsername_testable(anchor)).toBe('RedRecondite');
  });

  test('should extract username from data-hovercard-url (e.g., /users/rzhao271/hovercard)', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/rzhao271/hovercard' });
    expect(getUsername_testable(anchor)).toBe('rzhao271');
  });

  test('should extract username from data-hovercard-url with query params', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/test-user/hovercard?from=source' });
    expect(getUsername_testable(anchor)).toBe('test-user');
  });

  test('should prioritize data-hovercard-url over href', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/hover-user/hovercard', href: '/href-user' });
    expect(getUsername_testable(anchor)).toBe('hover-user');
  });

  test('should extract username from simple href (e.g., /RedRecondite) if no hovercard URL', () => {
    const anchor = createMockAnchor({ href: '/RedRecondite' });
    expect(getUsername_testable(anchor)).toBe('RedRecondite');
  });

  test('should extract username from href with allowed subpaths (e.g., /user/issues)', () => {
    const anchor = createMockAnchor({ href: '/someuser/issues' });
    expect(getUsername_testable(anchor)).toBe('someuser');
  });

  test('should extract username from href with query param (e.g., /user?tab=stars)', () => {
    const anchor = createMockAnchor({ href: '/another-user?tab=stars' });
    expect(getUsername_testable(anchor)).toBe('another-user');
  });

  test('should return null for complex hrefs not matching user profile patterns if no hovercard URL', () => {
    const anchor1 = createMockAnchor({ href: '/RedRecondite/bird-buddy-bot/commits?author=RedRecondite' });
    expect(getUsername_testable(anchor1)).toBeNull();
  });

  test('should correctly parse complex href if data-hovercard-url is present and correct', () => {
    const anchor2 = createMockAnchor({
        href: '/RedRecondite/bird-buddy-bot/commits?author=RedRecondite',
        hovercardUrl: '/users/RedRecondite/hovercard'
    });
    expect(getUsername_testable(anchor2)).toBe('RedRecondite');
  });

  test('should return null for blacklisted href paths (e.g., /orgs/test)', () => {
    const anchor = createMockAnchor({ href: '/orgs/testorg' });
    expect(getUsername_testable(anchor)).toBeNull();
  });

  test('should return null for invalid usernames from hovercard URL', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/Invalid--Username/hovercard' });
    expect(getUsername_testable(anchor)).toBeNull();
  });

  test('should return null for invalid usernames from href', () => {
    const anchor = createMockAnchor({ href: '/Invalid_Username' });
    expect(getUsername_testable(anchor)).toBeNull();
  });

  test('should return null if username contains [bot] from hovercard', () => {
    const anchor = createMockAnchor({ hovercardUrl: '/users/dependabot[bot]/hovercard' });
    expect(getUsername_testable(anchor)).toBeNull();
  });

  test('should return null for href like /login/oauth/authorize', () => {
    const anchor = createMockAnchor({ href: '/login/oauth/authorize' });
    expect(getUsername_testable(anchor)).toBeNull();
  });

  test('should return null for href that is just /', () => {
    const anchor = createMockAnchor({ href: '/' });
    expect(getUsername_testable(anchor)).toBeNull();
  });
});
