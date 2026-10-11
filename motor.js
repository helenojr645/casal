// Motor de calculo do app financeiro do casal.
// Codigo puro (sem tela, sem servidor): roda no navegador (window.Motor) e no Node (require).
// NUNCA colocar valores reais aqui: este arquivo vai para o GitHub Pages, que e publico.
//
// Conceitos:
//  - caixa: onde o dinheiro mora ('pote', 'heleno', 'ma'...). A visao do casal e a soma dos caixas.
//  - regra: algo que gera movimentos todo mes (salario, boleto, fatura, Pix para o pote).
//  - movimento: um valor numa data num caixa. Transferencia = 2 movimentos (sai de um, entra no outro).
//  - confirmacao: o realizado substitui o previsto (mesmo id), nunca soma.
//  - ajuste: "o saldo do banco hoje e X" -> o motor cria a diferenca como movimento identificado.
// Valores sempre em centavos inteiros por dentro (evita 0,1 + 0,2), reais na entrada e na saida.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Motor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- dinheiro ----------
  function c(v) { return Math.round(v * 100); }          // reais -> centavos
  function r(cents) { return cents / 100; }              // centavos -> reais

  // Divide um valor pelos pesos sem perder nem criar centavo (maior resto).
  // dividir(4430, {heleno: 6200, ma: 2900}) -> {heleno: 3018.24, ma: 1411.76}
  function dividir(valor, pesos) {
    var ids = Object.keys(pesos), total = 0, cents = c(valor), out = {}, soma = 0;
    ids.forEach(function (k) {
      if (typeof pesos[k] !== 'number' || !isFinite(pesos[k]) || pesos[k] < 0) throw new Error('dividir: peso invalido em ' + k);
      total += pesos[k];
    });
    if (total <= 0) throw new Error('dividir: pesos precisam somar mais que zero');
    var restos = ids.map(function (k) {
      var exato = cents * pesos[k] / total, base = Math.floor(exato);
      out[k] = base; soma += base;
      return { k: k, resto: exato - base };
    });
    restos.sort(function (a, b) { return b.resto - a.resto || (a.k < b.k ? -1 : 1); });
    for (var i = 0; soma < cents; i++, soma++) out[restos[i % restos.length].k]++;
    ids.forEach(function (k) { out[k] = r(out[k]); });
    return out;
  }

  // ---------- calendario (datas 'AAAA-MM-DD', sempre em UTC para nao sofrer com fuso) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dt(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))); }
  function fmt(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function somaDias(s, n) { var d = dt(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function ultimoDia(mes) { return new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate(); }
  function somaMeses(mes, n) {
    var y = +mes.slice(0, 4), m = +mes.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function meses(de, ate) { var out = []; for (var m = de; m <= ate; m = somaMeses(m, 1)) out.push(m); return out; }

  function pascoa(y) { // algoritmo de Meeus/Jones/Butcher
    var a = y % 19, b = Math.floor(y / 100), cc = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(cc / 4), k = cc % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31),
      dia = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + pad(mes) + '-' + pad(dia);
  }
  var cacheFeriados = {};
  // Dias sem expediente bancario nacional (vencimento passa pro proximo dia util).
  function feriados(y) { var o = {}, k, f = feriadosCache(y); for (k in f) o[k] = true; return o; }
  function feriadosCache(y) {
    if (cacheFeriados[y]) return cacheFeriados[y];
    var p = pascoa(y), set = {};
    ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25']
      .forEach(function (md) { set[y + '-' + md] = true; });
    if (y >= 2024) set[y + '-11-20'] = true; // Consciencia Negra virou feriado nacional (lei 14.759/2023)
    [-48, -47, -2, 60].forEach(function (n) { set[somaDias(p, n)] = true; }); // carnaval, sexta santa, corpus christi
    return (cacheFeriados[y] = set);
  }
  function ehDiaUtil(s) { var w = dt(s).getUTCDay(); return w !== 0 && w !== 6 && !feriadosCache(+s.slice(0, 4))[s]; }
  function proximoUtil(s) { while (!ehDiaUtil(s)) s = somaDias(s, 1); return s; }
  function anteriorUtil(s) { while (!ehDiaUtil(s)) s = somaDias(s, -1); return s; }
  function nDiaUtil(mes, n) {
    var s = mes + '-01', vistos = 0;
    for (;;) { if (ehDiaUtil(s) && ++vistos === n) return s; s = somaDias(s, 1); }
  }

  // Regra de data dentro de um mes:
  //   {dia: 15}                         dia fixo (dia 30 em fevereiro vira o ultimo dia)
  //   {dia: 1, ajuste: 'proximo'}       se cair em fim de semana/feriado, vai pro proximo dia util
  //   {dia: 30, ajuste: 'anterior'}     ...ou volta pro dia util anterior (salario costuma antecipar)
  //   {diaUtil: 5}                      5o dia util do mes
  function resolverData(regra, mes) {
    if (regra.diaUtil) return nDiaUtil(mes, regra.diaUtil);
    var s = mes + '-' + pad(Math.min(regra.dia, ultimoDia(mes)));
    if (regra.ajuste === 'proximo') return proximoUtil(s);
    if (regra.ajuste === 'anterior') return anteriorUtil(s);
    return s;
  }

  // ---------- regras -> movimentos ----------
  // Regra recorrente:
  //  {id, nome, caixa, tipo: 'entrada'|'saida'|'transferencia', para (so transferencia),
  //   data: <regra de data>, inicio: 'AAAA-MM', fim: 'AAAA-MM' (opcional, encerra sem apagar historico),
  //   vigencias: [{desde: 'AAAA-MM', valor}]   -> valor "deste mes em diante" (fixo ou estimativa)
  //   porMes: {'AAAA-MM': {valor, data}}       -> excecao "so este mes" (ex.: fatura informada)
  //   estimado: true                           -> valor das vigencias e so estimativa (luz, cartao)
  //   casa: true, grupo: 'fatura'|'fixa'|...   -> etiquetas para resumo e graficos}
  // Valor sempre positivo na regra; o tipo diz o sinal.
  function valorDoMes(regra, mes) {
    var ex = regra.porMes && regra.porMes[mes];
    if (ex && ex.valor != null) return { valor: ex.valor, origem: 'informado' };
    var v = null;
    var desde = '';
    (regra.vigencias || []).forEach(function (vg) { if (vg.desde <= mes && vg.desde >= desde) { desde = vg.desde; v = vg.valor; } });
    if (v == null) return { valor: null, origem: 'faltando' };
    return { valor: v, origem: regra.estimado ? 'estimado' : 'fixo' };
  }

  // Gera os movimentos de 'de' ate 'ate' (meses 'AAAA-MM', inclusive).
  // estado = {regras: [], avulsos: [], confirmacoes: {}}
  //  avulso: {id, nome, caixa, valor (+ entra / - sai), data, casa, grupo}
  //  confirmacoes['<regraId>|<mes>'] = {valor, data}  (valor pago/recebido de fato)
  function gerarMovimentos(estado, de, ate) {
    var movs = [], conf = estado.confirmacoes || {};
    (estado.regras || []).forEach(function (rg) {
      meses(de, ate).forEach(function (mes) {
        var id = rg.id + '|' + mes, cf = conf[id];
        // o que ja foi confirmado nunca some, mesmo fora da vigencia da regra
        if (!cf && rg.inicio && mes < rg.inicio.slice(0, 7)) return;
        if (!cf && rg.fim && mes > rg.fim.slice(0, 7)) return;
        var v = valorDoMes(rg, mes);
        var ex = rg.porMes && rg.porMes[mes];
        var data = (ex && ex.data) || resolverData(rg.data, mes);
        var base = { id: id, regra: rg.id, mes: mes, nome: rg.nome, casa: !!rg.casa, grupo: rg.grupo || null,
          origem: v.origem, confirmado: false, previsto: v.valor };
        if (cf) { // valor da confirmacao e sem sinal, como na regra (o tipo da o sinal)
          base.confirmado = true; base.origem = 'confirmado'; data = cf.data || data;
          v = { valor: cf.valor != null ? Math.abs(cf.valor) : v.valor };
        }
        var cents = v.valor == null ? 0 : c(v.valor);
        if (rg.tipo === 'transferencia') {
          movs.push(extend(base, { data: data, caixa: rg.caixa, cents: -cents, transferencia: true, perna: 'sai', para: rg.para }));
          movs.push(extend(base, { id: id + '>', data: data, caixa: rg.para, cents: cents, transferencia: true, perna: 'entra', de: rg.caixa }));
        } else {
          movs.push(extend(base, { data: data, caixa: rg.caixa, cents: rg.tipo === 'saida' ? -cents : cents }));
        }
      });
    });
    (estado.avulsos || []).forEach(function (a) {
      var mes = a.data.slice(0, 7);
      if (mes < de || mes > ate) return;
      movs.push({ id: a.id, regra: null, mes: mes, nome: a.nome, casa: !!a.casa, grupo: a.grupo || 'avulso',
        origem: 'avulso', confirmado: true, data: a.data, caixa: a.caixa, cents: c(a.valor) });
    });
    movs.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    movs.forEach(function (m) { m.valor = r(m.cents); });
    return movs;
  }
  function extend(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  // O que ja venceu e ninguem confirmou. Continua na previsao (nao some), so fica marcado.
  function pendentes(movs, hoje) {
    return movs.filter(function (m) { return m.regra && !m.confirmado && m.data < hoje && m.perna !== 'entra'; });
  }
  // Valores que faltam (fatura sem total e sem estimativa): a projecao esta incompleta.
  function faltando(movs) { return movs.filter(function (m) { return m.origem === 'faltando' && m.perna !== 'entra'; }); }

  // ---------- saldo dia a dia ----------
  // opts: {caixas: ['pote'] (omitido = todos), de, ate (datas), inicial: {caixa: valor} (saldo no inicio de 'de'),
  //        ajustes: [{caixa, data, saldo}]  (saldo informado no FIM daquele dia),
  //        periodos: [{id, de, ate}]        (se informado, o saldo zera no inicio de cada periodo: "a sobra nao acumula")}
  // Devolve [{data, inicio, fim, movimentos, ajuste}] com valores em reais.
  function saldoDiario(movs, opts) {
    if (opts.periodos && opts.periodos.length && opts.ajustes && opts.ajustes.length)
      throw new Error('saldoDiario: ajuste de saldo real nao combina com periodos que zeram (a sobra nao acumula)');
    var naVisao = visao(opts.caixas), cents = 0, out = [], porDia = {}, ajustes = {};
    Object.keys(opts.inicial || {}).forEach(function (k) { if (naVisao(k)) cents += c(opts.inicial[k]); });
    movs.forEach(function (m) { if (naVisao(m.caixa)) (porDia[m.data] = porDia[m.data] || []).push(m); });
    (opts.ajustes || []).forEach(function (a) { if (naVisao(a.caixa)) (ajustes[a.data] = ajustes[a.data] || []).push(a); });
    var inicioPeriodo = {};
    (opts.periodos || []).forEach(function (p) { inicioPeriodo[p.de] = true; });
    var porCaixa = {}; // ajuste e por caixa: precisa do saldo daquele caixa
    Object.keys(opts.inicial || {}).forEach(function (k) { if (naVisao(k)) porCaixa[k] = c(opts.inicial[k]); });
    for (var d = opts.de; d <= opts.ate; d = somaDias(d, 1)) {
      if (inicioPeriodo[d] && d !== opts.de) { cents = 0; porCaixa = {}; }
      var ini = cents, lista = porDia[d] || [];
      lista.forEach(function (m) { cents += m.cents; porCaixa[m.caixa] = (porCaixa[m.caixa] || 0) + m.cents; });
      var aj = 0;
      (ajustes[d] || []).forEach(function (a) {
        var dif = c(a.saldo) - (porCaixa[a.caixa] || 0);
        porCaixa[a.caixa] = c(a.saldo); cents += dif; aj += dif;
      });
      out.push({ data: d, inicio: r(ini), fim: r(cents), movimentos: lista, ajuste: aj ? r(aj) : 0 });
    }
    return out;
  }
  function visao(caixas) {
    if (!caixas) return function () { return true; };
    var s = {}; caixas.forEach(function (k) { s[k] = true; });
    return function (k) { return !!s[k]; };
  }
  function piorDia(serie) {
    var p = null;
    serie.forEach(function (d) { if (!p || d.fim < p.fim) p = d; });
    return p && { data: p.data, saldo: p.fim };
  }

  // ---------- resumo por periodo ----------
  // Ciclo do salario: o "mes" comeca no dia em que cai o salario-ancora e vai ate a vespera do proximo.
  // ciclos(['2026-10','2026-11'], {dia: 30}) -> [{id:'2026-10', de:'2026-09-30', ate:'2026-10-29'}, ...]
  function ciclos(lista, regraInicio) {
    return lista.map(function (m) {
      return { id: m, de: resolverData(regraInicio, somaMeses(m, -1)), ate: somaDias(resolverData(regraInicio, m), -1) };
    });
  }
  function mesesCalendario(lista) {
    return lista.map(function (m) { return { id: m, de: m + '-01', ate: m + '-' + pad(ultimoDia(m)) }; });
  }
  // Entradas, saidas e resultado de cada periodo na visao pedida.
  // Transferencia entre dois caixas da mesma visao se anula e nao conta como receita nem despesa.
  // Transferencia que cruza a fronteira da visao (ex.: Pix do Heleno para o pote, na visao do Heleno)
  // conta separada em 'transfSai'/'transfEntra'.
  function resumo(movs, periodos, caixas) {
    var naVisao = visao(caixas);
    return periodos.map(function (p) {
      var o = { id: p.id, de: p.de, ate: p.ate, entradas: 0, saidas: 0, transfEntra: 0, transfSai: 0, casa: 0, estimado: 0, faltando: 0 };
      movs.forEach(function (m) {
        if (m.data < p.de || m.data > p.ate || !naVisao(m.caixa)) return;
        if (m.origem === 'faltando' && m.perna !== 'entra') o.faltando++;
        if (m.origem === 'estimado' && m.perna !== 'entra') o.estimado += Math.abs(m.cents);
        if (m.transferencia) {
          var outro = m.perna === 'sai' ? m.para : m.de;
          if (naVisao(outro)) return;
          if (m.cents > 0) o.transfEntra += m.cents; else o.transfSai -= m.cents;
          return;
        }
        if (m.cents > 0) o.entradas += m.cents; else o.saidas -= m.cents;
        if (m.cents < 0 && m.casa) o.casa -= m.cents;
      });
      o.resultado = o.entradas - o.saidas;            // receita - despesa (o "resultado do mes")
      o.sobra = o.resultado + o.transfEntra - o.transfSai; // o que fica no bolso de fato
      ['entradas', 'saidas', 'transfEntra', 'transfSai', 'casa', 'estimado', 'resultado', 'sobra']
        .forEach(function (k) { o[k] = r(o[k]); });
      return o;
    });
  }

  // ---------- operacoes de edicao (devolvem a regra alterada; o chamador grava) ----------
  // "So este mes": vira excecao em porMes. Nao mexe nos outros meses.
  function alterarSoEsteMes(regra, mes, valor, data) {
    regra.porMes = regra.porMes || {};
    regra.porMes[mes] = extend(regra.porMes[mes] || {}, { valor: valor });
    if (data) regra.porMes[mes].data = data;
    return regra;
  }
  // "Este mes e os proximos": nova vigencia. Meses anteriores continuam com o valor antigo.
  // Vale ate a proxima vigencia ja agendada (ex.: reajuste conhecido de janeiro), que e preservada.
  // A tela deve avisar quando houver vigencia futura (vigenciasDepois).
  function alterarDaquiPraFrente(regra, mes, valor) {
    regra.vigencias = (regra.vigencias || []).filter(function (v) { return v.desde !== mes; });
    regra.vigencias.push({ desde: mes, valor: valor });
    regra.vigencias.sort(function (a, b) { return a.desde < b.desde ? -1 : 1; });
    if (regra.porMes && regra.porMes[mes]) { // a excecao 'so este mes' do proprio mes deixa de valer
      delete regra.porMes[mes].valor;
      if (!regra.porMes[mes].data) delete regra.porMes[mes];
    }
    return regra;
  }
  function vigenciasDepois(regra, mes) { return (regra.vigencias || []).filter(function (v) { return v.desde > mes; }); }
  // Encerrar recorrencia: ultimo mes que ainda vale. O historico continua gerado ate la.
  function encerrar(regra, ultimoMes) { regra.fim = ultimoMes; return regra; }

  return {
    dividir: dividir,
    pascoa: pascoa, feriados: feriados, ehDiaUtil: ehDiaUtil, proximoUtil: proximoUtil, anteriorUtil: anteriorUtil,
    nDiaUtil: nDiaUtil, resolverData: resolverData, somaDias: somaDias, somaMeses: somaMeses, meses: meses,
    valorDoMes: valorDoMes, gerarMovimentos: gerarMovimentos, pendentes: pendentes, faltando: faltando,
    saldoDiario: saldoDiario, piorDia: piorDia, ciclos: ciclos, mesesCalendario: mesesCalendario, resumo: resumo,
    alterarSoEsteMes: alterarSoEsteMes, alterarDaquiPraFrente: alterarDaquiPraFrente, vigenciasDepois: vigenciasDepois, encerrar: encerrar
  };
});
