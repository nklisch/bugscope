<template>
	<section class="kt-section browser-showcase">
		<div class="section-inner">
			<h2 class="section-title">What Your Agent Sees</h2>
			<p class="section-subtitle">
				While you browse, Krometrail records everything via Chrome DevTools Protocol. When you drop a marker,
				your agent gets the full picture — no copy-pasting errors into chat.
			</p>

			<div class="capture-grid">
				<div v-for="cap in capabilities" :key="cap.title" class="capture-card kt-card kt-border-cyan">
					<h3 class="cap-title">{{ cap.title }}</h3>
					<p class="cap-desc">{{ cap.desc }}</p>
				</div>
			</div>

			<div class="session-demo">
				<div class="demo-header">
					<span class="demo-label">Agent's view of your session</span>
				</div>
				<pre class="demo-body"><code><span class="marker">⚑ Marker: "checkout broke"</span> at 00:51

<span class="section-head">Network</span>
  POST /api/orders → <span class="error">500 Internal Server Error</span> (2.1s)
  Response: {"error": "discount_code_invalid"}

<span class="section-head">Console</span>
  <span class="error">Error: Unhandled promise rejection: discount_code_invalid</span>

<span class="section-head">Framework</span>
  React: OrderForm state { code: "SAVE15", applying: true }
  → discountApplied never set (component stuck in loading state)

<span class="section-head">Screenshot</span>
  [Captured at marker — spinner visible, no error shown to user]</code></pre>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
const _capabilities = [
	{
		title: "Network requests",
		desc: "Every XHR/fetch with status, timing, headers, and response bodies — failed requests highlighted.",
	},
	{
		title: "Console & errors",
		desc: "All console output and unhandled errors, timestamped and correlated with network events.",
	},
	{
		title: "Framework state",
		desc: "React and Vue component trees, props, and state captured at each marker.",
	},
	{
		title: "DOM & storage",
		desc: "DOM mutations, user interactions, localStorage/sessionStorage/cookie changes — all diffed.",
	},
	{
		title: "Screenshots",
		desc: "Automatic screenshots at markers and on errors. Visual proof of what you saw.",
	},
	{
		title: "Timeline",
		desc: "Everything timestamped and ordered. Your agent can search, inspect, and diff any moment.",
	},
];
</script>

<style scoped>
.browser-showcase {
	border-top: 1px solid var(--vp-c-divider);
}

.section-inner {
	max-width: 1200px;
	margin: 0 auto;
	padding: 0 24px;
}

.section-title {
	font-size: 2rem;
	font-weight: 600;
	color: var(--vp-c-text-1);
	margin: 0 0 12px;
}

.section-subtitle {
	font-size: 1.05rem;
	color: var(--vp-c-text-2);
	line-height: 1.7;
	max-width: 640px;
	margin: 0 0 48px;
}

.capture-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
	margin-bottom: 48px;
}

.capture-card {
	transition: border-color var(--kt-transition), box-shadow var(--kt-transition);
}

.capture-card:hover {
	box-shadow: 0 4px 20px rgba(34, 211, 238, 0.12);
}

.cap-title {
	font-size: 1rem;
	font-weight: 600;
	color: var(--vp-c-text-1);
	margin: 0 0 6px;
}

.cap-desc {
	font-size: 0.875rem;
	color: var(--vp-c-text-2);
	line-height: 1.6;
	margin: 0;
}

.session-demo {
	background: var(--vp-c-bg-soft);
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--kt-radius-card);
	overflow: hidden;
	box-shadow: var(--kt-shadow);
}

.demo-header {
	background: var(--vp-c-bg-mute);
	padding: 10px 16px;
	border-bottom: 1px solid var(--vp-c-divider);
}

.demo-label {
	font-size: 0.8rem;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--vp-c-text-3);
}

.demo-body {
	margin: 0;
	padding: 20px;
	background: transparent;
	border: none;
	overflow-x: auto;
}

.demo-body code {
	font-family: var(--vp-font-family-mono);
	font-size: 0.82rem;
	line-height: 1.7;
	color: var(--vp-c-text-1);
	white-space: pre;
}

.marker {
	color: var(--vp-c-brand-1);
	font-weight: 600;
}

.section-head {
	color: var(--kt-accent-cyan);
	font-weight: 600;
}

.error {
	color: #ef4444;
}

@media (max-width: 900px) {
	.capture-grid {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (max-width: 560px) {
	.capture-grid {
		grid-template-columns: 1fr;
	}
}
</style>
