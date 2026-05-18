chrome.runtime.onMessage.addListener((function(e,n,o){if("pS"===e.type)try{new Audio(chrome.runtime.getURL("sounds/sound.ogg")).play()}catch(e){}}));
