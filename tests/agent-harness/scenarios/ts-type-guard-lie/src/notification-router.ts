/**
 * Notification routing system.
 * Routes email, SMS, and push notifications to the correct delivery channel.
 */

export interface EmailNotification {
	kind: "email";
	to: string;
	subject: string;
	body: string;
	replyTo?: string;
}

export interface SmsNotification {
	kind: "sms";
	phone: string;
	message: string;
}

export interface PushNotification {
	kind: "push";
	deviceToken: string;
	title: string;
	payload: Record<string, unknown>;
}

export type Notification = EmailNotification | SmsNotification | PushNotification;

export interface DeliveryResult {
	channel: string;
	recipient: string;
	status: "sent" | "failed";
	detail?: string;
}

/**
 * Type guard for SMS notifications.
 *
 * BUG: this guard checks for the presence of a `phone` property instead of
 * checking the `kind` discriminant. A push notification enriched by middleware
 * (which adds `phone` and `message` from a contact lookup) will incorrectly
 * match this guard, causing the router to treat it as an SMS notification and
 * use the phone number as the recipient instead of the device token.
 */
function isSmsNotification(n: Notification): n is SmsNotification {
	// BUG: should check `n.kind === "sms"`, not duck-type on `phone`
	return typeof (n as Record<string, unknown>).phone === "string";
}

function isEmailNotification(n: Notification): n is EmailNotification {
	return n.kind === "email";
}

/**
 * Determine the recipient address for a notification.
 */
function formatRecipient(notification: Notification): string {
	if (isSmsNotification(notification)) {
		return notification.phone;
	}
	if (isEmailNotification(notification)) {
		return notification.to;
	}
	// Push notification
	return (notification as PushNotification).deviceToken;
}

/**
 * Route a single notification to its delivery channel.
 * In production this would call the appropriate delivery service.
 */
export function routeNotification(notification: Notification): DeliveryResult {
	const recipient = formatRecipient(notification);
	const channel = notification.kind;
	return {
		channel,
		recipient,
		status: "sent",
		detail: `Delivered via ${channel} to ${recipient}`,
	};
}

/**
 * Route a batch of notifications.
 * Accepts raw objects from the API (which may have extra enrichment fields).
 */
export function routeBatch(notifications: Notification[]): DeliveryResult[] {
	return notifications.map(routeNotification);
}
