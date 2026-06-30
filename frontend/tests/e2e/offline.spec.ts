import { test, expect } from '@playwright/test';

test.describe('PWA Offline Functionality', () => {
  test('should show offline banner when network is disconnected', async ({ page, context }) => {
    await page.goto('/');
    
    // Go offline
    await context.setOffline(true);
    
    // Wait for offline banner to appear
    await expect(page.getByText(/offline/i)).toBeVisible({ timeout: 5000 });
    
    // Go back online
    await context.setOffline(false);
    
    // Wait for offline banner to disappear
    await expect(page.getByText(/offline/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('should disable transaction buttons when offline', async ({ page, context }) => {
    // Navigate to a job detail page (assumes test data exists)
    await page.goto('/jobs/test-job-id');
    
    // Find a milestone submit button (if present)
    const submitButton = page.getByRole('button', { name: /submit milestone/i }).first();
    
    if (await submitButton.isVisible()) {
      // Initially should be enabled
      await expect(submitButton).toBeEnabled();
      
      // Go offline
      await context.setOffline(true);
      
      // Wait a moment for state to update
      await page.waitForTimeout(1000);
      
      // Button should be disabled
      await expect(submitButton).toBeDisabled();
      
      // Hover to see tooltip
      await submitButton.hover();
      await expect(page.getByText(/blockchain transactions require.*internet/i)).toBeVisible();
      
      // Go back online
      await context.setOffline(false);
      
      // Wait for state to update
      await page.waitForTimeout(1000);
      
      // Button should be enabled again
      await expect(submitButton).toBeEnabled();
    }
  });

  test('should queue job application when offline', async ({ page, context }) => {
    // Navigate to job listing
    await page.goto('/jobs');
    
    // Go offline first
    await context.setOffline(true);
    
    // Wait for offline indicator
    await expect(page.getByText(/offline/i)).toBeVisible();
    
    // Try to apply to a job (if apply button exists)
    const applyButton = page.getByRole('button', { name: /apply/i }).first();
    
    if (await applyButton.isVisible()) {
      await applyButton.click();
      
      // Fill application form
      await page.fill('[name="coverLetter"]', 'Test cover letter for offline application');
      await page.fill('[name="proposedRate"]', '100');
      
      // Submit application
      await page.getByRole('button', { name: /submit.*application/i }).click();
      
      // Should show queued message or confirmation
      await expect(page.getByText(/queued|saved|will be sent/i)).toBeVisible();
    }
  });

  test('should sync queued applications when back online', async ({ page, context }) => {
    // First queue an application offline
    await page.goto('/jobs');
    await context.setOffline(true);
    
    // Queue an application (similar to previous test)
    const applyButton = page.getByRole('button', { name: /apply/i }).first();
    if (await applyButton.isVisible()) {
      await applyButton.click();
      await page.fill('[name="coverLetter"]', 'Test offline sync');
      await page.fill('[name="proposedRate"]', '150');
      await page.getByRole('button', { name: /submit.*application/i }).click();
    }
    
    // Go back online
    await context.setOffline(false);
    
    // Wait for sync to complete
    await page.waitForTimeout(2000);
    
    // Should show success message or notification
    await expect(page.getByText(/application.*submitted|success/i)).toBeVisible({ timeout: 10000 });
  });

  test('should cache pages for offline viewing', async ({ page, context }) => {
    // Visit pages while online to cache them
    await page.goto('/');
    await page.goto('/jobs');
    await page.goto('/about');
    
    // Go offline
    await context.setOffline(true);
    
    // Navigate to cached pages - should still work
    await page.goto('/');
    await expect(page).toHaveTitle(/stellar.*market/i);
    
    await page.goto('/jobs');
    await expect(page.getByText(/jobs|opportunities/i)).toBeVisible();
    
    await page.goto('/about');
    await expect(page.getByText(/about/i)).toBeVisible();
  });

  test('should show pending sync indicator', async ({ page, context }) => {
    await page.goto('/');
    
    // Queue some actions while offline
    await context.setOffline(true);
    
    // Trigger an action that gets queued (e.g., send message)
    // This is placeholder logic - adjust based on actual UI
    const messageButton = page.getByRole('button', { name: /send.*message/i }).first();
    if (await messageButton.isVisible()) {
      await messageButton.click();
      await page.fill('[name="message"]', 'Test offline message');
      await page.getByRole('button', { name: /send/i }).click();
    }
    
    // Should show pending sync indicator in offline banner
    await expect(page.getByText(/pending|queued/i)).toBeVisible();
    
    // Go back online
    await context.setOffline(false);
    
    // Pending indicator should disappear after sync
    await expect(page.getByText(/pending|queued/i)).not.toBeVisible({ timeout: 10000 });
  });

  test('should register service worker', async ({ page }) => {
    await page.goto('/');
    
    // Check if service worker is registered
    const swRegistered = await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        return !!registration;
      }
      return false;
    });
    
    expect(swRegistered).toBe(true);
  });

  test('should have valid PWA manifest', async ({ page }) => {
    await page.goto('/');
    
    // Check manifest link exists
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', '/site.webmanifest');
    
    // Fetch and validate manifest
    const manifestUrl = await manifestLink.getAttribute('href');
    const response = await page.request.get(manifestUrl!);
    expect(response.ok()).toBe(true);
    
    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
