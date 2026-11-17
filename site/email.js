/* leprixdubetail.fr — adresse e-mail protégée contre les robots.

   Reprise fidèle de deux techniques de Spencer Mortensen, combinées :
   https://spencermortensen.com/articles/email-obfuscation/#link-interaction
   https://spencermortensen.com/articles/email-obfuscation/#text-interaction

   Ni le lien ni le texte ne contiennent l'adresse dans le HTML. Le texte
   affiché est un leurre (mot parasite, lettre parasite, faux domaine) : même
   en remplaçant ses espaces, un robot obtient une mauvaise adresse.
   Les deux ne sont décodés qu'à la première interaction réelle avec la page. */

'use strict';

document.addEventListener('DOMContentLoaded', function ()
{
	const listener = new Listener();

	listener.decode = function ()
	{
		document.querySelectorAll('a.email').forEach(function (a)
		{
			// link interaction : « tontact-leprixdubetail/ »
			a.setAttribute('href', a.getAttribute('href')
				.replace('/', '.fr')
				.replace('-', '@')
				.replace('t', 'mailto:c')
			);

			// text interaction : « votre ckontkact example fr »
			const email = a.firstChild;

			email.nodeValue = email.nodeValue
				.replace('votre ', '')
				.replaceAll('k', '')
				.replace(' ', '@')
				.replaceAll(' ', '.')
				.replace('example', 'leprixdubetail');
		});
	}

	listener.on();

	// Filet de sécurité : si l'adresse n'est pas encore décodée au moment du clic
	// (navigateur sans les événements ci-dessus), on décode puis on ouvre le lien.
	document.querySelectorAll('a.email').forEach(function (a)
	{
		a.addEventListener('click', function (evenement)
		{
			if (a.getAttribute('href').startsWith('mailto:'))
				return;

			evenement.preventDefault();
			listener.decode();
			window.location.href = a.getAttribute('href');
		});
	});
});


// Listener

function Listener ()
{
}

Listener.prototype.decode = null;

// Au doigt, il n'y a ni survol ni focus : on écoute aussi le toucher et le
// défilement, sinon l'adresse resterait brouillée sur mobile.
Listener.EVENEMENTS = ['mouseenter', 'focus', 'pointerdown', 'touchstart', 'keydown', 'scroll'];

Listener.prototype.on = function ()
{
	this.listener = this.__onInteraction.bind(this);

	Listener.EVENEMENTS.forEach(function (nom)
	{
		document.addEventListener(nom, this.listener, { capture: true, passive: true });
	}, this);
}

Listener.prototype.off = function ()
{
	Listener.EVENEMENTS.forEach(function (nom)
	{
		document.removeEventListener(nom, this.listener, { capture: true });
	}, this);

	delete this.listener;
}

Listener.prototype.__onInteraction = function ()
{
	this.off();
	this.decode();
}
