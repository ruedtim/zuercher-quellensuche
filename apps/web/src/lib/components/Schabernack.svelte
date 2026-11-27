<script lang="ts">
	import { onMount } from "svelte";

	const DURATION_MS = 60_000;
	const EASE = 0.05;
	const SIZE = 90;
	const SNOUT_OFFSET = 28;

	let visible = $state(false);
	let x = $state(0);
	let y = $state(0);
	let tx = 0;
	let ty = 0;
	let facing = $state(1);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function trigger() {
		if (timeout) clearTimeout(timeout);
		const startX = window.innerWidth / 2 - SIZE / 2;
		const startY = window.innerHeight - SIZE - 40;
		x = startX;
		y = startY;
		tx = startX;
		ty = startY;
		facing = 1;
		visible = true;
		timeout = setTimeout(() => {
			visible = false;
			timeout = null;
		}, DURATION_MS);
	}

	onMount(() => {
		window.addEventListener("schabernack:trigger", trigger);
		return () => {
			window.removeEventListener("schabernack:trigger", trigger);
			if (timeout) clearTimeout(timeout);
		};
	});

	$effect(() => {
		if (!visible) return;

		const fine = window.matchMedia("(pointer: fine)").matches;
		const eventName = fine ? "pointermove" : "pointerdown";

		function onPointer(e: PointerEvent) {
			tx = e.clientX - SIZE / 2 - facing * SNOUT_OFFSET;
			ty = e.clientY - SIZE / 2;
		}

		let rafId = 0;
		function tick() {
			const dx = tx - x;
			const dy = ty - y;
			x += dx * EASE;
			y += dy * EASE;
			if (Math.abs(dx) > 1) facing = dx > 0 ? 1 : -1;
			rafId = requestAnimationFrame(tick);
		}

		window.addEventListener(eventName, onPointer);
		rafId = requestAnimationFrame(tick);

		return () => {
			window.removeEventListener(eventName, onPointer);
			cancelAnimationFrame(rafId);
		};
	});
</script>

{#if visible}
	<div
		class="schabernack"
		aria-hidden="true"
		style="transform: translate({x}px, {y}px);"
	>
		<div class="rider">
			<img src="/schabernack.png" alt="" style="transform: scaleX({facing});" />
		</div>
	</div>
{/if}

<style>
	.schabernack {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 50;
		pointer-events: none;
		will-change: transform;
	}
	.rider {
		animation: schabernack-bob 0.32s ease-in-out infinite alternate;
		transform-origin: 50% 80%;
		will-change: transform;
	}
	.rider img {
		height: 90px;
		width: auto;
		display: block;
		will-change: transform;
	}
	@keyframes schabernack-bob {
		from { transform: translateY(0)     rotate(-5deg); }
		to   { transform: translateY(-10px) rotate(5deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.schabernack {
			display: none;
		}
	}
</style>
