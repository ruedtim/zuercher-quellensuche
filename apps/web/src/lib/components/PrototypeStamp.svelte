<!--
	Stempel «Inoffizieller Prototyp» (Wortlaut Tim 2026-11-23) neben dem Namen im Kopf. Der
	Kopf klebt oben (+layout.svelte), der Stempel ist darum auf jeder Seite immer sichtbar.
	Führt auf die Erklärung in /about#prototyp.

	Die abgenutzte Stempelfarbe ist eine Überlagerung in der Farbe des Kopfs, keine Maske:
	Zeigt ein Browser das SVG-Rauschen nicht, steht der Stempel unversehrt da, nie unsichtbar.
-->
<a href="/about#prototyp" class="stamp" title="Inoffizieller Prototyp – was heisst das?">
	<span class="top">Inoffizieller</span>
	<span class="main">Prototyp</span>
</a>

<style>
	.stamp {
		position: relative;
		display: inline-flex;
		flex: none;
		flex-direction: column;
		align-items: center;
		padding: 0.34rem 0.8rem 0.36rem;
		color: #ff7158;
		border: 5px double currentColor;
		border-radius: 5px;
		line-height: 1;
		text-transform: uppercase;
		transform: rotate(-4deg);
		transition: color 0.15s ease;
	}
	.stamp:hover {
		color: #ff917d;
	}
	.stamp:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}
	.stamp::after {
		content: "";
		position: absolute;
		inset: -5px;
		pointer-events: none;
		/* Aussetzer in der Farbe des Kopfs (zszh-900, #0d0b12; sRGB, sonst rechnet der Filter
		   linear und die Punkte werden grau) */
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='160'><filter id='n' x='0' y='0' width='100%25' height='100%25' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 .051  0 0 0 0 .043  0 0 0 0 .071  0 0 0 6 -3.55'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
	}
	.top {
		margin: 0 -0.135em 0.2rem 0;
		font-size: 0.92rem;
		font-weight: 800;
		letter-spacing: 0.135em;
	}
	.main {
		margin-right: -0.185em;
		font-size: 1.36rem;
		font-weight: 900;
		letter-spacing: 0.185em;
	}
	/* wie im Layout: unter 1000 px klebt nur die Zeile mit Name und Stempel */
	@media (max-width: 999px) {
		.stamp {
			padding: 0.24rem 0.5rem 0.26rem;
			border-width: 4px;
		}
		.stamp::after {
			inset: -4px;
			opacity: 0.7; /* kleine Schrift: schwächer abgenutzt */
		}
		.top {
			margin: 0 -0.1em 0.14rem 0;
			font-size: 0.66rem;
			letter-spacing: 0.1em;
		}
		.main {
			margin-right: -0.15em;
			font-size: 0.95rem;
			letter-spacing: 0.15em;
		}
	}
	@media (max-width: 429px) {
		.stamp {
			padding: 0.2rem 0.4rem 0.22rem;
		}
		.top {
			font-size: 0.57rem;
		}
		.main {
			font-size: 0.82rem;
		}
	}
	@media (max-width: 349px) {
		.stamp {
			padding: 0.2rem 0.34rem;
		}
		.top {
			font-size: 0.5rem;
		}
		.main {
			font-size: 0.72rem;
		}
	}
</style>
