(function () {
  if (location.protocol !== 'file:') return;
  var path = decodeURIComponent(location.pathname).replace(/\\/g, '/');
  var target = /\/web\/dist\/index\.html$/i.test(path) ? '../../Grafo.html' : /\/web\/index\.html$/i.test(path) ? '../Grafo.html' : null;
  if (target) location.replace(target);
})();
