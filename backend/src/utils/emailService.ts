/**
 * Stub email sender: waits 2 seconds, fails 30% of the time
 */
async function sendRawEmail(to: string, subject: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (Math.random() < 0.3) {
    throw new Error(`SMTP connection timeout while sending email to${to}`);
  }

  console.log(`✉️ [Email Service] Successfully sent email to${to}`);
}

/**
 * Fire-and-Forget runner with Exponential Backoff Retry!
 */
export function triggerConfirmationEmail(email: string, jobId: string) {
  // Fire asynchronously — DO NOT AWAIT in HTTP handler!
  sendWithRetry(email, jobId, 3, 1000).catch((finalError) => {
    // Durable error logging so failed notifications never silently vanish
    console.error(
      `🚨 [CRITICAL ALERT] All email retries exhausted for${email}:`,
      finalError.message,
    );
  });
}

async function sendWithRetry(
  email: string,
  jobId: string,
  maxRetries: number,
  delayMs: number,
): Promise<void> {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      attempt++;
      await sendRawEmail(email, `Application Confirmation for Job #${jobId}`);
      return; // Success!
    } catch (err: any) {
      console.warn(
        `⚠️ [Email Retry] Attempt${attempt}/${maxRetries} failed for${email}:${err.message}`,
      );
      if (attempt >= maxRetries) {
        throw err;
      }
      // Exponential backoff delay
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)),
      );
    }
  }
}
