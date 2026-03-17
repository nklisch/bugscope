<template>
	<section class="hero-section">
		<div class="hero-bg" aria-hidden="true" />
		<div class="hero-inner">
			<div class="hero-headline">
				<h1 class="hero-title">
					Reproduce the bug.<br />
					<span class="hero-title-accent">Your agent fixes it.</span>
				</h1>
				<p class="hero-subtitle">
					Browse your app, hit a bug, drop a marker. Krometrail captures the full runtime context — browser state,
					network, console, framework state — so your coding agent can investigate and fix it without guessing.
				</p>
				<div class="hero-ctas">
					<a :href="withBase('/guide/getting-started')" class="kt-btn-primary">Get Started</a>
					<a href="https://github.com/nklisch/krometrail" class="kt-btn-outline" target="_blank" rel="noopener">
						View on GitHub
					</a>
				</div>
			</div>

			<div class="hero-workflow">
				<div class="workflow-step">
					<div class="step-number">1</div>
					<div class="step-content">
						<h3 class="step-title">Reproduce</h3>
						<p class="step-desc">Use your app in Chrome like normal. Click around, fill forms, trigger the bug.</p>
					</div>
				</div>
				<div class="workflow-arrow" aria-hidden="true">&rarr;</div>
				<div class="workflow-step">
					<div class="step-number">2</div>
					<div class="step-content">
						<h3 class="step-title">Mark</h3>
						<p class="step-desc">Hit the marker button when something goes wrong. Krometrail captures everything.</p>
					</div>
				</div>
				<div class="workflow-arrow" aria-hidden="true">&rarr;</div>
				<div class="workflow-step">
					<div class="step-number">3</div>
					<div class="step-content">
						<h3 class="step-title">Hand off</h3>
						<p class="step-desc">Your agent gets the full session — network, errors, DOM, framework state — and debugs the code.</p>
					</div>
				</div>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { withBase } from "vitepress";
</script>

<style scoped>
.hero-section {
	position: relative;
	overflow: hidden;
	padding: 80px 0 96px;
}

.hero-bg {
	position: absolute;
	inset: 0;
	background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124, 58, 237, 0.18) 0%, transparent 70%);
	pointer-events: none;
}

.hero-inner {
	max-width: 1200px;
	margin: 0 auto;
	padding: 0 24px;
	display: flex;
	flex-direction: column;
	gap: 56px;
	align-items: center;
}

.hero-headline {
	text-align: center;
	max-width: 680px;
}

.hero-title {
	font-size: clamp(2.2rem, 5vw, 3.5rem);
	font-weight: 600;
	line-height: 1.15;
	letter-spacing: -0.02em;
	color: var(--vp-c-text-1);
	margin: 0 0 20px;
}

.hero-title-accent {
	color: var(--vp-c-brand-1);
}

.hero-subtitle {
	font-size: 1.125rem;
	line-height: 1.7;
	color: var(--vp-c-text-2);
	margin: 0 0 32px;
}

.hero-ctas {
	display: flex;
	gap: 12px;
	justify-content: center;
	flex-wrap: wrap;
}

.hero-workflow {
	display: flex;
	align-items: flex-start;
	gap: 16px;
	width: 100%;
	max-width: 800px;
}

.workflow-step {
	flex: 1;
	background: var(--vp-c-bg-soft);
	border: 1px solid var(--vp-c-divider);
	border-radius: var(--kt-radius-card);
	padding: 24px 20px;
	box-shadow: var(--kt-shadow);
	text-align: center;
}

.step-number {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: var(--vp-c-brand-soft);
	border: 1px solid var(--vp-c-brand-1);
	color: var(--vp-c-brand-1);
	font-size: 0.85rem;
	font-weight: 700;
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0 auto 12px;
}

.step-title {
	font-size: 1rem;
	font-weight: 600;
	color: var(--vp-c-text-1);
	margin: 0 0 6px;
}

.step-desc {
	font-size: 0.875rem;
	color: var(--vp-c-text-2);
	line-height: 1.6;
	margin: 0;
}

.workflow-arrow {
	color: var(--vp-c-text-3);
	font-size: 1.3rem;
	margin-top: 40px;
	flex-shrink: 0;
}

@media (max-width: 768px) {
	.hero-workflow {
		flex-direction: column;
		align-items: stretch;
	}

	.workflow-arrow {
		text-align: center;
		margin-top: 0;
		transform: rotate(90deg);
	}

	.hero-section {
		padding: 56px 0 72px;
	}
}
</style>
