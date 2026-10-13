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

  // Conta da casa (simulacao pedida pelo Heleno em 12/10): uma conta separada, que comeca o ciclo zerada, para onde
  // cada um manda a sua parte e de onde saem as contas (e, numa das versoes, tambem as faturas dos cartoes).
  //  - a Ma manda quando recebe: no salario o que der (ja sem o que gastou por fora) e o resto nas rendas seguintes;
  //  - o Heleno manda o que sobra do total: em cada salario so o que a conta precisa ate o salario seguinte dele,
  //    e o restante no ultimo.
  // Tudo em centavos. Nao lanca erro: se uma saida vier antes do deposito, devolve 'negativo' com a data.
  // saidas = [{d, v, regra}] (v positivo); rendas = [{d, v, regra}] em ordem de data; descontoMa sai da 1a renda dela.
  function contaCasa(saidas, parteMa, rendasMa, descontoMa, rendasH, inicio) {
    var total = 0, linhas = [];
    saidas.forEach(function (x) { total += x.v; linhas.push({ d: x.d, quem: null, regra: x.regra, v: -x.v }); });
    var cMa = Math.max(0, Math.min(parteMa, total)), cH = total - cMa, resto = cMa, depMa = [];
    rendasMa.forEach(function (x, i) {
      var v = i === rendasMa.length - 1 ? resto : Math.max(0, Math.min(resto, x.v - (i === 0 ? descontoMa : 0)));
      if (v > 0) depMa.push({ d: x.d, quem: 'ma', regra: x.regra, v: v });
      resto -= v;
    });
    if (resto > 0) depMa.push({ d: inicio, quem: 'ma', regra: null, v: resto });
    var dias = [], salario = {};
    rendasH.forEach(function (x) { if (dias.indexOf(x.d) < 0) dias.push(x.d); salario[x.d] = (salario[x.d] || 0) + x.v; if (!salario['r' + x.d]) salario['r' + x.d] = x.regra; });
    if (!dias.length) dias.push(inicio);
    var jaH = 0;
    dias.forEach(function (d, i) {
      var v = cH - jaH;
      if (i < dias.length - 1) { // quanto a conta precisa antes do proximo salario dele
        var precisa = 0;
        saidas.forEach(function (s) {
          if (s.d < d || s.d >= dias[i + 1]) return;
          var saiu = 0, entrou = jaH;
          saidas.forEach(function (o) { if (o.d <= s.d) saiu += o.v; });
          depMa.forEach(function (o) { if (o.d <= s.d) entrou += o.v; });
          precisa = Math.max(precisa, saiu - entrou);
        });
        v = Math.min(v, precisa);
      }
      if (v > 0) linhas.push({ d: d, quem: 'heleno', regra: salario['r' + d] || null, v: v, cabe: !(d in salario) || v <= salario[d] });
      jaH += v;
    });
    linhas = linhas.concat(depMa).map(function (x, k) { x.k = k; return x; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.v > 0) !== (b.v > 0) ? (a.v > 0 ? -1 : 1) : a.k - b.k; });
    var saldo = 0, negativo = null, n = { ma: 0, heleno: 0 };
    var extrato = linhas.map(function (x) {
      saldo += x.v;
      if (saldo < 0 && !negativo) negativo = x.d;
      var o = { d: x.d, quem: x.quem, regra: x.regra, v: r(x.v), saldo: r(saldo) };
      if (x.quem) { o.n = ++n[x.quem]; if (x.cabe === false) o.naoCabe = true; }
      return o;
    });
    return { ma: r(cMa), heleno: r(cH), total: r(total), depositos: n, extrato: extrato, negativo: negativo };
  }

  // estado.divisao = {
  //   boleto: 'boleto', outras: ['agualuz','internet'], aluguel: valor (so para exibir),
  //   maCasa: {boleto: {padrao, 'AAAA-MM'}, outras: {padrao}},
  //   receitasMa: ['salma','pai'], cartaoMa: 'btg', parteMa: {'AAAA-MM': valor},
  //   divida: valor da parcela, porFora: {'AAAA-MM': valor}, cicloDia: 30 }
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
      // conta da casa (simulacao): so as contas da casa, ou as contas e as faturas
      var porData = function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; };
      var rendas = function (deMa) {
        return doCiclo.filter(function (x) { return x.cents > 0 && x.regra && ehMa(x) === deMa; }).map(function (x) { return { d: x.data, v: x.cents, regra: x.regra }; }).sort(porData);
      };
      var saidasDe = function (comFaturas) {
        return doCiclo.filter(function (x) { return x.cents < 0 && (x.regra === D.boleto || D.outras.indexOf(x.regra) >= 0 || (comFaturas && x.grupo === 'fatura')); })
          .map(function (x) { return { d: x.data, v: -x.cents, regra: x.regra }; }).sort(porData);
      };
      var rMa = rendas(true), rH = rendas(false), desc = c(fora) + c(avLev), cMaCasa = c(maBoleto) + c(maOutras);
      var conta = { casa: contaCasa(saidasDe(false), cMaCasa, rMa, desc, rH, p.de), fat: contaCasa(saidasDe(true), cMaCasa + c(maCartao), rMa, desc, rH, p.de) };
      return {
        conta: conta,
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
