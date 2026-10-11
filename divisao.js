// Regra de divisao do casal (fechada pelo Heleno em 07/10/2026, ajustes de 10/10):
//  - a Ma paga uma parte FIXA da casa: X do boleto do ape + Y das outras contas (agua, luz, internet);
//  - a renda dela segue esta fila: gastos por fora -> boleto -> cartao dela -> outras contas -> divida;
//  - faltou para o cartao dela: o Heleno paga a fatura e ela passa a DEVER (emprestimo);
//  - faltou para as outras contas: o Heleno cobre e NAO vira divida;
//  - a divida so recebe o que sobrar e pode atrasar.
// Codigo puro, sem valor real (vai para o GitHub Pages). Depende do motor.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motor.js'));
  else root.Divisao = factory(root.Motor);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  function c(v) { return Math.round(v * 100); }
  function r(x) { return x / 100; }
  function doMes(tab, mes) { return tab ? (mes in tab ? tab[mes] : tab.padrao || 0) : 0; }
  // valor conhecido mais recente ate o mes (estimativa para meses ainda sem fatura)
  function ultimoAte(tab, mes) {
    var v = 0, k = '';
    Object.keys(tab || {}).forEach(function (m) { if (m <= mes && m >= k) { k = m; v = tab[m]; } });
    return { valor: v, estimado: k !== mes };
  }

  // estado.divisao = {
  //   boleto: 'boleto', outras: ['agualuz','internet'], aluguel: 3000 (so para exibir),
  //   maCasa: {boleto: {padrao, 'AAAA-MM'}, outras: {padrao}},
  //   receitasMa: ['salma','pai'], cartaoMa: 'btg', parteMa: {'AAAA-MM': valor},
  //   divida: 500, porFora: {'AAAA-MM': valor}, cicloDia: 30 }
  // opts.porForaFuturo: valor para meses sem 'porFora' informado (simular "como outubro"); padrao 0.
  function calcular(estado, meses, opts) {
    opts = opts || {};
    var D = estado.divisao, cic = M.ciclos(meses, { dia: D.cicloDia || 30 });
    var movs = M.gerarMovimentos(estado, M.somaMeses(meses[0], -1), meses[meses.length - 1]);
    var casal = M.resumo(movs, cic), regra = {};
    estado.regras.forEach(function (x) { regra[x.id] = x; });
    var atraso = 0, devendo = 0;
    return cic.map(function (p, i) {
      var m = p.id, doCiclo = movs.filter(function (x) { return x.data >= p.de && x.data <= p.ate && !x.transferencia; });
      function soma(f) { var t = 0; doCiclo.forEach(function (x) { if (f(x)) t += x.cents; }); return t; }
      function deRegra(id) { return -soma(function (x) { return x.regra === id; }) / 100; }
      var casa = { boleto: deRegra(D.boleto), outras: 0, itens: {} };
      D.outras.forEach(function (id) { var v = deRegra(id); casa.itens[id] = v; casa.outras = r(c(casa.outras) + c(v)); });
      casa.aluguel = casa.boleto >= (D.aluguel || Infinity) ? D.aluguel : 0;
      var casaTotal = r(c(casa.boleto) + c(casa.outras));
      var cheiaBoleto = doMes(D.maCasa.boleto, m), cheiaOutras = doMes(D.maCasa.outras, m);
      var parte = { ma: r(c(cheiaBoleto) + c(cheiaOutras)) };
      parte.heleno = r(c(casaTotal) - c(parte.ma));
      var pm = ultimoAte(D.parteMa, m), cartaoCheio = pm.valor;

      // fila da Ma, em centavos: cada degrau leva o que der do que sobrou
      // gasto/entrada avulsa marcada como da Ma entra na fila dela (gasto = 'por fora'; entrada = renda dela)
      var ehMa = function (x) { return D.receitasMa.indexOf(x.regra) >= 0 || (!x.regra && x.caixa === 'ma'); };
      var entra = soma(function (x) { return x.cents > 0 && ehMa(x); });
      var avulsoMa = r(-soma(function (x) { return x.cents < 0 && !x.regra && x.caixa === 'ma'; }));
      var resto = entra;
      function leva(v) { var x = Math.max(0, Math.min(resto, c(v))); resto -= x; return r(x); }
      var porForaInf = D.porFora && m in D.porFora;
      // primeiro os gastos avulsos dela (dinheiro que ja saiu de verdade), depois o 'por fora' informado
      var avLev = leva(avulsoMa), foraExcesso = r(c(avulsoMa) - c(avLev)); // gastou alem da renda: saiu do Heleno
      var fora = leva(porForaInf ? D.porFora[m] : (opts.porForaFuturo || 0));
      var maBoleto = leva(cheiaBoleto), maCartao = leva(cartaoCheio), maOutras = leva(cheiaOutras), maDivida = leva(D.divida);
      var faltaBoleto = r(c(cheiaBoleto) - c(maBoleto)); // a regra nao preve: o Heleno cobre, e a tela avisa
      var emprestimo = r(c(cartaoCheio) - c(maCartao));
      var falta = r(c(cheiaOutras) - c(maOutras) + c(faltaBoleto)), maFica = r(resto);
      atraso = r(c(atraso) + c(D.divida) - c(maDivida));
      devendo = r(c(devendo) + c(emprestimo));

      // Heleno: tudo o que nao e da Ma. A sobra dele sai da identidade com o motor (casal = Heleno + Ma + por fora).
      var hEntra = r(soma(function (x) { return x.cents > 0 && !ehMa(x); }));
      var faturas = {}, cartoes = 0;
      doCiclo.forEach(function (x) {
        if (x.grupo !== 'fatura') return;
        var v = -x.cents; if (x.regra === D.cartaoMa) v -= c(cartaoCheio);
        faturas[x.regra] = r((c(faturas[x.regra] || 0)) + v); cartoes += v;
      });
      var outrosGastos = r(-soma(function (x) { return x.cents < 0 && x.grupo !== 'fatura' && x.regra !== D.boleto && D.outras.indexOf(x.regra) < 0 && !(!x.regra && x.caixa === 'ma'); }));
      var hCasa = r(c(parte.heleno) + c(falta));
      // o 'por fora' informado nao e movimento no motor (o casal ainda o conta como dinheiro); o avulso dela ja e
      var hFica = r(c(casal[i].resultado) - c(maFica) - c(fora));
      var conferido = r(c(hEntra) + c(maDivida) - cartoes - c(outrosGastos) - c(hCasa) - c(emprestimo) - c(foraExcesso));
      if (c(conferido) !== c(hFica)) throw new Error(m + ': a divisao nao fecha com o motor (' + conferido + ' x ' + hFica + ')');
      var dataCartao = null;
      doCiclo.forEach(function (x) { if (x.regra === D.cartaoMa) dataCartao = x.data; });
      return {
        mes: m, de: p.de, ate: p.ate, casa: casa, casaTotal: casaTotal, parte: parte, falta: falta, faltaBoleto: faltaBoleto,
        parcela: D.divida, atraso: atraso, devendo: devendo, casal: casal[i].resultado,
        ma: { entra: r(entra), porFora: fora, avulsos: avLev, foraExcesso: foraExcesso, porForaInformado: porForaInf, boleto: maBoleto, cartao: maCartao, cartaoCheio: cartaoCheio,
          cartaoEstimado: pm.estimado, outras: maOutras, divida: maDivida, fica: maFica },
        heleno: { entra: hEntra, divida: maDivida, faturas: faturas, cartoes: r(cartoes), outrosGastos: outrosGastos,
          casaParte: parte.heleno, cobre: falta, empresta: emprestimo, cobreGastoMa: foraExcesso, fica: hFica, dataCartao: dataCartao }
      };
    });
  }
  return { calcular: calcular };
});
