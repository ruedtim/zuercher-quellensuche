<script lang="ts">
	import { tick } from "svelte";

	// Geteilter Feedback-Dialog: Trigger + Popover (Muster wie
	// DownloadPackage.svelte). Zwei Varianten – `header` (hell auf dunkler
	// Kopfzeile) und `link` (sekundärer Inline-Link, z. B. «Zuordnung melden»).
	// Beim Absenden POST an /api/feedback, das ein GitHub-Issue erstellt.
	let {
		variant = "link",
		label = undefined,
	}: {
		variant?: "header" | "link";
		label?: string;
	} = $props();

	const triggerLabel = $derived(label ?? "Feedback");

	let open = $state(false);
	let message = $state("");
	let contact = $state("");
	// Unsichtbares Feld: Menschen lassen es leer, Programme füllen es aus (der Server verwirft sie still).
	let website = $state("");
	let phase = $state<"idle" | "submitting" | "done" | "error">("idle");
	let resultNumber = $state<number | null>(null);
	let errorMsg = $state("");

	let popoverEl: HTMLDivElement | null = $state(null);
	let buttonEl: HTMLButtonElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);
	let doneEl: HTMLParagraphElement | null = $state(null);

	const canSubmit = $derived(message.trim().length > 0 && phase !== "submitting");

	function toggle() {
		open = !open;
		if (open) {
			// Fokus ins Textfeld, sobald das Popover gemountet ist.
			queueMicrotask(() => textareaEl?.focus());
		}
	}

	function close() {
		open = false;
	}

	/** Escape und «Abbrechen»: zurück zum Knopf, sonst verliert die Tastatur ihren Ort. */
	function dismiss() {
		close();
		buttonEl?.focus();
	}

	function resetForm() {
		message = "";
		contact = "";
		phase = "idle";
		resultNumber = null;
		errorMsg = "";
	}

	function onDocClick(event: MouseEvent) {
		if (!open) return;
		const t = event.target as Node;
		if (popoverEl?.contains(t)) return;
		if (buttonEl?.contains(t)) return;
		close();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === "Escape" && open) dismiss();
	}

	$effect(() => {
		if (typeof window === "undefined") return;
		document.addEventListener("click", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	});

	async function submit() {
		if (!canSubmit) return;
		phase = "submitting";
		errorMsg = "";
		try {
			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					kind: "general",
					message: message.trim(),
					contact: contact.trim() || undefined,
					website: website || undefined,
					context: { url: window.location.href },
				}),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => null)) as { message?: string } | null;
				errorMsg = data?.message || "Konnte nicht gesendet werden.";
				phase = "error";
				return;
			}
			const data = (await res.json()) as { number: number | null };
			resultNumber = data.number;
			phase = "done";
			// Das Formular ist weg: Fokus auf die Bestätigung, damit sie vorgelesen wird.
			await tick();
			doneEl?.focus();
		} catch {
			errorMsg = "Konnte nicht gesendet werden.";
			phase = "error";
		}
	}
</script>

<div class="relative inline-block">
	<button
		type="button"
		bind:this={buttonEl}
		onclick={toggle}
		aria-expanded={open}
		aria-haspopup="dialog"
		class={variant === "header"
			? "inline-flex items-baseline gap-1 hover:underline underline-offset-4 decoration-2"
			: "inline-flex items-center gap-1 text-xs text-zszh-600 hover:text-accent-600 hover:underline"}
	>
		<!-- Kopfzeile: Icon erst ab sm, auf schmalen Handys braucht die Nav den Platz. -->
		<svg
			class={variant === "header" ? "hidden sm:block w-4 h-4 self-center relative -top-0.5" : "w-3.5 h-3.5"}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.5 7.2L4 20l1.1-3.3A8 8 0 1121 12z"
			/>
		</svg>
		{triggerLabel}
	</button>

	{#if open}
		<!-- Mobile: zentriertes Overlay mit abgedunkeltem Hintergrund – das
		     ~22rem-Popover würde sonst, am Trigger verankert, über den
		     Bildschirmrand hinausragen. Ab sm: Overlay wird ein statischer
		     0-Höhe-Wrapper, das Popover hängt wie gehabt am Trigger. -->
		<div
			class="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-3 pt-6 sm:static sm:block sm:bg-transparent sm:p-0"
		>
			<div
				bind:this={popoverEl}
				role="dialog"
				aria-label="Feedback geben"
				class="relative z-50 w-full max-w-sm max-h-[85vh] overflow-y-auto sm:absolute sm:z-30 sm:mt-2 sm:max-h-none sm:overflow-visible sm:w-[min(22rem,calc(100vw-2rem))] {variant ===
				'header'
					? 'sm:right-0'
					: 'sm:left-0'} bg-white border border-zszh-200 rounded-md shadow-lg p-4 font-sans text-sm normal-case tracking-normal text-zszh-800"
			>
			{#if phase === "done"}
				<p bind:this={doneEl} tabindex="-1" class="focus:outline-none">
					<span class="block font-medium text-zszh-900">Danke für Ihr Feedback!</span>
					<span class="block mt-1 text-zszh-600">
						{#if resultNumber}
							Erfasst als Nr.&nbsp;{resultNumber}.
						{:else}
							Ihr Feedback wurde übermittelt.
						{/if}
					</span>
				</p>
				<div class="flex justify-end pt-3">
					<button
						type="button"
						onclick={() => {
							resetForm();
							dismiss();
						}}
						class="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white font-medium rounded-md"
					>
						Schliessen
					</button>
				</div>
			{:else}
				<label class="block font-medium text-zszh-900 mb-1" for="feedback-message">
					Ihr Feedback
				</label>
				<textarea
					id="feedback-message"
					bind:this={textareaEl}
					bind:value={message}
					rows="4"
					placeholder="Was funktioniert gut, was fehlt, was stört?"
					class="w-full px-3 py-2 bg-white border border-zszh-300 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-accent-500"
				></textarea>

				<label class="block text-xs text-zszh-700 mt-2 mb-1" for="feedback-contact">
					Kontakt (optional)
				</label>
				<input
					id="feedback-contact"
					bind:value={contact}
					type="text"
					placeholder="E-Mail, falls eine Rückfrage erwünscht ist"
					class="w-full px-3 py-1.5 bg-white border border-zszh-300 rounded-md focus:outline-none focus:ring-2 focus:ring-accent-500"
				/>
				<input
					bind:value={website}
					type="text"
					name="website"
					tabindex="-1"
					autocomplete="off"
					aria-hidden="true"
					class="sr-only"
				/>
				<p class="mt-1 text-xs text-zszh-500">
					Freiwillig – wird nur zur Beantwortung Ihres Feedbacks genutzt. Die Rückmeldung wird mit der
					Adresse dieser Seite nicht öffentlich bei GitHub (USA) gespeichert
					(<a href="/datenschutz" class="underline hover:text-zszh-700">Datenschutz</a>).
				</p>

				{#if phase === "error"}
					<p class="mt-2 text-xs text-red-700" role="alert">{errorMsg}</p>
				{/if}

				<div class="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-zszh-100">
					<button type="button" onclick={dismiss} class="px-3 py-1.5 text-zszh-600 hover:text-zszh-900">
						Abbrechen
					</button>
					<button
						type="button"
						onclick={submit}
						disabled={message.trim().length === 0}
						aria-disabled={phase === "submitting"}
						class="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 disabled:bg-zszh-300 disabled:cursor-not-allowed aria-disabled:bg-zszh-300 aria-disabled:cursor-not-allowed text-white font-medium rounded-md"
					>
						{phase === "submitting" ? "Wird gesendet …" : "Senden"}
					</button>
				</div>
			{/if}
			</div>
		</div>
	{/if}
</div>
