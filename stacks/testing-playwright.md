# Playwright Testing Stack Profile

## Detection

```bash
# Detect Playwright
grep -E '"@playwright/test"|"playwright"' package.json 2>/dev/null | head -1
```

## Best Practices

### Test Project Structure

```
e2e/
├── tests/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   └── logout.spec.ts
│   ├── users/
│   │   ├── create-user.spec.ts
│   │   └── user-list.spec.ts
│   └── shared/
│       └── navigation.spec.ts
├── fixtures/
│   ├── auth.fixture.ts
│   └── database.fixture.ts
├── pages/
│   ├── login.page.ts
│   └── dashboard.page.ts
├── utils/
│   └── test-helpers.ts
└── playwright.config.ts
```

### Page Object Model

```typescript
// pages/login.page.ts
import { Page, Locator } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("Password");
    this.submitButton = page.getByRole("button", { name: "Sign in" });
    this.errorMessage = page.getByRole("alert");
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }
}
```

### Test Structure

```typescript
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/login.page";

test.describe("Login", () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await loginPage.login("user@example.com", "password123");

    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("invalid credentials shows error", async () => {
    await loginPage.login("wrong@example.com", "wrongpassword");

    await loginPage.expectError("Invalid credentials");
  });
});
```

### Locator Strategies (Priority Order)

```typescript
// 1. Best: User-facing attributes
page.getByRole("button", { name: "Submit" });
page.getByLabel("Email address");
page.getByPlaceholder("Enter your email");
page.getByText("Welcome back");

// 2. Good: Test IDs (when semantic locators don't work)
page.getByTestId("user-avatar");

// 3. Acceptable: CSS selectors (stable classes)
page.locator(".user-card");

// 4. Avoid: XPath, nth-child, auto-generated classes
// Bad: page.locator("//div[@class='css-1a2b3c']")
```

### Custom Fixtures

```typescript
// fixtures/auth.fixture.ts
import { test as base, Page } from "@playwright/test";

type AuthFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Setup: Login
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/dashboard");

    // Provide the authenticated page
    await use(page);

    // Teardown: Logout
    await page.getByRole("button", { name: "Logout" }).click();
  },
});

// Usage
test("authenticated user can view profile", async ({ authenticatedPage }) => {
  await authenticatedPage.goto("/profile");
  await expect(authenticatedPage.getByText("My Profile")).toBeVisible();
});
```

### API Mocking

```typescript
test("displays user data from API", async ({ page }) => {
  // Mock API response
  await page.route("**/api/users/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        name: "Test User",
        email: "test@example.com",
      }),
    });
  });

  await page.goto("/profile");
  await expect(page.getByText("Test User")).toBeVisible();
});

test("handles API errors gracefully", async ({ page }) => {
  await page.route("**/api/users/me", (route) =>
    route.fulfill({ status: 500 })
  );

  await page.goto("/profile");
  await expect(page.getByText("Failed to load profile")).toBeVisible();
});
```

### Visual Regression Testing

```typescript
test("dashboard matches snapshot", async ({ page }) => {
  await page.goto("/dashboard");

  // Wait for dynamic content
  await page.waitForLoadState("networkidle");

  // Full page screenshot
  await expect(page).toHaveScreenshot("dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});

test("user card component", async ({ page }) => {
  await page.goto("/users");

  // Element screenshot
  const userCard = page.getByTestId("user-card").first();
  await expect(userCard).toHaveScreenshot("user-card.png");
});
```

## Common Mistakes

### Mistake: Hard-Coded Waits

```typescript
// Bad: Arbitrary wait times
await page.click("#submit");
await page.waitForTimeout(3000); // Don't do this!

// Good: Wait for specific conditions
await page.getByRole("button", { name: "Submit" }).click();
await expect(page.getByText("Success")).toBeVisible();

// Good: Wait for navigation
await page.getByRole("link", { name: "Dashboard" }).click();
await page.waitForURL("/dashboard");
```

### Mistake: Flaky Element Selection

```typescript
// Bad: Relies on DOM structure
page.locator("div > div:nth-child(2) > span");

// Bad: Auto-generated classes
page.locator(".css-1ab2cd3");

// Good: Semantic locators
page.getByRole("cell", { name: "John Doe" });
page.getByTestId("user-name");
```

### Mistake: Not Waiting for Network

```typescript
// Bad: Race condition with API
await page.goto("/users");
await expect(page.getByRole("row")).toHaveCount(10); // May fail if API slow

// Good: Wait for network idle
await page.goto("/users");
await page.waitForLoadState("networkidle");
await expect(page.getByRole("row")).toHaveCount(10);

// Better: Wait for specific response
await page.goto("/users");
await page.waitForResponse("**/api/users");
await expect(page.getByRole("row")).toHaveCount(10);
```

### Mistake: Test Interdependence

```typescript
// Bad: Test 2 depends on Test 1's state
test("create user", async ({ page }) => {
  // Creates user "John"
});

test("edit user", async ({ page }) => {
  // Expects "John" to exist - fails if run alone!
});

// Good: Each test is independent
test("edit user", async ({ page }) => {
  // Setup: Create user first
  await createTestUser({ name: "John" });

  // Test edit functionality
  await page.goto("/users/john/edit");
});
```

### Mistake: Not Cleaning Up Test Data

```typescript
// Bad: Test data accumulates
test("create user", async ({ page }) => {
  await page.fill("[name=email]", "test@example.com");
  await page.click("button[type=submit]");
  // User created but never cleaned up
});

// Good: Use fixtures for cleanup
test.describe("User creation", () => {
  test.afterEach(async ({ request }) => {
    // Clean up test users via API
    await request.delete("/api/test/users");
  });

  test("create user", async ({ page }) => {
    // Test runs with clean state
  });
});
```

## Review Checklist

- [ ] Page Object Model used for reusable components
- [ ] Semantic locators preferred (getByRole, getByLabel)
- [ ] No hard-coded waits (waitForTimeout)
- [ ] Tests are independent (no shared state)
- [ ] API responses mocked when appropriate
- [ ] Visual regression tests have tolerance set
- [ ] Custom fixtures handle setup/teardown
- [ ] Error scenarios tested
- [ ] Tests run in parallel safely
- [ ] CI configuration includes retries

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
