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
});


// Listener

function Listener ()
{
}

Listener.prototype.decode = null;

Listener.prototype.on = function ()
{
	this.listener = this.__onInteraction.bind(this);

	document.addEventListener('mouseenter', this.listener, true);
	document.addEventListener('focus', this.listener, true);
}

Listener.prototype.off = function ()
{
	document.removeEventListener('mouseenter', this.listener, true);
	document.removeEventListener('focus', this.listener, true);

	delete this.listener;
}

Listener.prototype.__onInteraction = function ()
{
	this.off();
	this.decode();
}
