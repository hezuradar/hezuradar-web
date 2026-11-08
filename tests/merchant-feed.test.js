"use strict";

// Feed de productos para Google Merchant Center (assets/js/merchant-feed.js).

const { loadBrowserModule } = require("./helpers");
const T = loadBrowserModule("assets/js/product-page-template.js").HA_TEMPLATE;
const F = loadBrowserModule("assets/js/merchant-feed.js").HA_MERCHANT_FEED;

const sample = (over) =>
  Object.assign(
    {
      id: "1b7b0469-24a3",
      title: "Selleta de hueso de vaca Kobe en bruto 85 × 4 × 10 mm",
      description: "Hueso de vaca Kobe.\n\nPara tallar una selleta.",
      price: 4.5,
      discountPercent: null,
      stock: 3,
      sku: "RR0015",
      category: "Hueso",
      subcategory: "Selleta",
      images: ["images/products/a_0.webp", "images/products/a_1.webp"],
      slug: "hueso-de-vaca-kobe-para-selleta-1b7b0469",
    },
    over
  );

const itemsOf = (xml) => xml.split("<item>").slice(1);

test("el feed es un RSS 2.0 con el espacio de nombres de Google", () => {
  const xml = F.buildMerchantFeed([sample()], T);
  assertTrue(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "falta la cabecera XML");
  assertTrue(xml.includes('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">'), "falta el rss con xmlns:g");
  assertEqual(itemsOf(xml).length, 1);
});

test("cada producto lleva los campos obligatorios de Merchant Center", () => {
  const item = itemsOf(F.buildMerchantFeed([sample()], T))[0];
  [
    "<g:id>RR0015</g:id>",
    "<title>Selleta de hueso de vaca Kobe en bruto 85 × 4 × 10 mm</title>",
    "<link>https://hezuradar.com/productos/hueso-de-vaca-kobe-para-selleta-1b7b0469.html</link>",
    "<g:image_link>https://hezuradar.com/images/products/a_0.webp</g:image_link>",
    "<g:additional_image_link>https://hezuradar.com/images/products/a_1.webp</g:additional_image_link>",
    "<g:availability>in_stock</g:availability>",
    "<g:price>4.50 EUR</g:price>",
    "<g:condition>new</g:condition>",
    "<g:brand>HezurAdar</g:brand>",
    "<g:mpn>RR0015</g:mpn>",
    "<g:identifier_exists>no</g:identifier_exists>",
    "<g:product_type>Hueso &gt; Selleta</g:product_type>",
  ].forEach((tag) => assertTrue(item.includes(tag), "falta " + tag + " en\n" + item));
});

test("la descripción va en texto plano, en una línea", () => {
  const item = itemsOf(F.buildMerchantFeed([sample()], T))[0];
  assertTrue(item.includes("<description>Hueso de vaca Kobe. Para tallar una selleta.</description>"), item);
});

test("sin stock se publica como out_of_stock", () => {
  const item = itemsOf(F.buildMerchantFeed([sample({ stock: 0 })], T))[0];
  assertTrue(item.includes("<g:availability>out_of_stock</g:availability>"), item);
});

test("un descuento se publica como sale_price sobre el precio normal", () => {
  const item = itemsOf(F.buildMerchantFeed([sample({ price: 10, discountPercent: 20 })], T))[0];
  assertTrue(item.includes("<g:price>10.00 EUR</g:price>"), item);
  assertTrue(item.includes("<g:sale_price>8.00 EUR</g:sale_price>"), item);
});

test("sin descuento no hay sale_price", () => {
  const item = itemsOf(F.buildMerchantFeed([sample()], T))[0];
  assertFalse(item.includes("sale_price"), item);
});

test("se escapan los caracteres especiales de XML", () => {
  const item = itemsOf(F.buildMerchantFeed([sample({ title: 'Cuerno <negro> & "ámbar"' })], T))[0];
  assertTrue(item.includes("<title>Cuerno &lt;negro&gt; &amp; &quot;ámbar&quot;</title>"), item);
});

test("se omiten los productos sin página o sin foto", () => {
  const xml = F.buildMerchantFeed([sample({ slug: "" }), sample({ images: [] }), sample()], T);
  assertEqual(itemsOf(xml).length, 1);
});

test("sin referencia, el id es el id interno del producto", () => {
  const item = itemsOf(F.buildMerchantFeed([sample({ sku: "" })], T))[0];
  assertTrue(item.includes("<g:id>1b7b0469-24a3</g:id>"), item);
  assertFalse(item.includes("<g:mpn>"), item);
});

test("el catálogo real genera un feed sin productos repetidos", () => {
  const products = require("../data/products.json");
  const xml = F.buildMerchantFeed(products, T);
  const ids = (xml.match(/<g:id>[^<]+<\/g:id>/g) || []);
  assertEqual(new Set(ids).size, ids.length, "ids repetidos en el feed");
  assertTrue(ids.length > 0, "el feed real está vacío");
});
