-- =====================================================================
--  FINAL MENU (from the owner's new menus): run once in Supabase → SQL Editor → Run.
--  Safe to run again. Nothing is deleted: dishes not on the new menu are only HIDDEN
--  (old orders keep their names). The custom drinks ("… su misura") are not touched.
--  After running it, every tablet and phone shows the new menu by itself.
-- =====================================================================

-- the dishes can be in the sections Piatto del giorno and Champagne (their own tabs for the waiters)
alter table public.menu_items drop constraint if exists menu_items_section_check;
alter table public.menu_items add constraint menu_items_section_check
  check (section in ('giorno','primi','secondi','dolci','pinsa','aperitivo','caffe','bibite','cocktail','vino','champagne','liquori'));

insert into public.menu_items(id, section, name_it, name_en, price, sort, hidden) values
  ('lasagne', 'giorno', 'Lasagne alla bolognese', 'Lasagne with Bolognese meat sauce', 13, 1, false),
  ('spag-pom', 'primi', 'Spaghetto al pomodoro', 'Spaghetti with tomato sauce', 12, 1, false),
  ('pasta-speck', 'primi', 'Pasta fatta in casa al pomodoro con speck e funghi', 'Homemade pasta with tomato sauce, speck and mushrooms', 13, 2, false),
  ('zuppa', 'primi', 'Zuppa di cereali e legumi', 'Cereal and legume soup', 14, 3, false),
  ('carbonara', 'primi', 'Spaghetti alla carbonara', 'Spaghetti alla carbonara', 13, 4, false),
  ('risotto', 'primi', 'Risotto ai funghi porcini', 'Risotto with porcini mushrooms', 13, 5, false),
  ('ravioli', 'primi', 'Ravioli ripieni di ricotta e spinaci con datterino e basilico', 'Ravioli filled with ricotta and spinach, cherry tomato and basil', 13, 6, false),
  ('polpette', 'secondi', 'Polpette al sugo con pomodori e piselli', 'Meatballs in tomato sauce with tomatoes and peas', 17, 1, false),
  ('filetto', 'secondi', 'Filetto di pollo con funghi e patate', 'Chicken fillet with mushrooms and potatoes', 15, 2, false),
  ('cotoletta', 'secondi', 'Cotoletta di pollo con patate a spicchi', 'Breaded chicken cutlet with potato wedges', 13, 3, false),
  ('souffle-cioc', 'dolci', 'Soufflé dal cuore caldo al cioccolato', 'Chocolate lava soufflé', 8, 1, false),
  ('souffle-pist', 'dolci', 'Soufflé dal cuore caldo al pistacchio', 'Pistachio lava soufflé', 8, 2, false),
  ('tiramisu', 'dolci', 'Tiramisù', 'Tiramisu', 8.5, 3, false),
  ('pinsa-rosmarino', 'pinsa', 'Pinsa olio, sale e rosmarino', 'Olive oil, salt and rosemary', 9, 1, false),
  ('pinsa-mortadella', 'pinsa', 'Pinsa mortadella, stracciatella e granella di pistacchio', 'Mortadella, stracciatella, chopped pistachios', 13, 2, false),
  ('pinsa-cotto', 'pinsa', 'Pinsa prosciutto cotto e formaggio', 'Cooked ham and cheese', 14, 3, false),
  ('pinsa-speck', 'pinsa', 'Pinsa speck e scamorza affumicata', 'Speck and smoked scamorza', 14, 4, false),
  ('pinsa-bresaola', 'pinsa', 'Pinsa bresaola, rucola e grana', 'Bresaola, rocket and Grana', 16, 5, false),
  ('pinsa-tricolore', 'pinsa', 'Pinsa tricolore: ovoline di mozzarella, pomodorini e pesto genovese', 'Mini mozzarella, cherry tomatoes, Genovese pesto cream', 12, 6, false),
  ('aperitif', 'aperitivo', 'Aperitif Experience', 'Per person · drink + typical homemade products', 25, 1, false),
  ('espresso', 'caffe', 'Caffè espresso', 'Espresso', 3, 1, false),
  ('decaf', 'caffe', 'Caffè decaffeinato', 'Decaffeinated coffee', 3.5, 2, false),
  ('orzo', 'caffe', 'Orzo', 'Barley coffee', 4, 3, false),
  ('ginseng', 'caffe', 'Ginseng', 'Ginseng coffee', 4, 4, false),
  ('americano', 'caffe', 'Caffè americano', 'American coffee', 5, 5, false),
  ('cappuccino', 'caffe', 'Cappuccino', 'Cappuccino', 5, 6, false),
  ('te-verde', 'caffe', 'Tè verde', 'Green tea', 5, 7, false),
  ('te-nero', 'caffe', 'Tè nero', 'Black tea', 5, 8, false),
  ('te-earl', 'caffe', 'Tè Earl Grey', 'Earl Grey tea', 5, 9, false),
  ('cioccolata', 'caffe', 'Cioccolata calda', 'Hot chocolate', 5, 10, false),
  ('spremuta', 'bibite', 'Spremuta d''arancia', 'Orange juice', 6.5, 1, false),
  ('redbull', 'bibite', 'Red Bull 0,25 l', 'Red Bull', 6.5, 2, false),
  ('acqua', 'bibite', 'Acqua minerale 0,50 l', 'Mineral water', 3.5, 3, false),
  ('coca', 'bibite', 'Coca-Cola', 'Coke', 5, 4, false),
  ('coca-zero', 'bibite', 'Coca-Cola Zero', 'Coke Zero', 5, 5, false),
  ('fanta', 'bibite', 'Fanta', 'Fanta', 5, 6, false),
  ('schweppes', 'bibite', 'Schweppes tonica', 'Tonic water', 5, 7, false),
  ('manhattan', 'cocktail', 'Manhattan Cocktail', 'Cocktail', 15, 1, false),
  ('aperol', 'cocktail', 'Aperol Spritz', 'Cocktail', 15, 2, false),
  ('campari', 'cocktail', 'Campari Spritz', 'Cocktail', 15, 3, false),
  ('limoncello-spritz', 'cocktail', 'Limoncello Spritz', 'Cocktail', 15, 4, false),
  ('mojito', 'cocktail', 'Mojito', 'Cocktail', 15, 5, false),
  ('cuba', 'cocktail', 'Cuba Libre', 'Cocktail', 15, 6, false),
  ('gin-tonic', 'cocktail', 'Gin Tonic', 'Cocktail', 15, 7, false),
  ('vodka-tonic', 'cocktail', 'Vodka Tonic', 'Cocktail', 15, 8, false),
  ('americano-ck', 'cocktail', 'Americano', 'Cocktail (not coffee)', 15, 9, false),
  ('negroni', 'cocktail', 'Negroni', 'Cocktail', 15, 10, false),
  ('spum-c', 'vino', 'Vino spumante · calice', 'Sparkling wine · glass', 9, 1, false),
  ('spum-b', 'vino', 'Vino spumante · bottiglia', 'Sparkling wine · bottle', 29, 2, false),
  ('bianco-c', 'vino', 'Chardonnay Lazio · calice', 'White wine · glass', 8, 3, false),
  ('bianco-b', 'vino', 'Chardonnay Lazio · bottiglia', 'White wine · bottle', 32, 4, false),
  ('gewurz-c', 'vino', 'Gewürztraminer d''Isera · calice', 'White wine · glass', 10, 5, false),
  ('gewurz-b', 'vino', 'Gewürztraminer d''Isera · bottiglia', 'White wine · bottle', 40, 6, false),
  ('ribolla-c', 'vino', 'Ribolla Gialla · calice', 'White wine · glass', 9, 7, false),
  ('ribolla-b', 'vino', 'Ribolla Gialla · bottiglia', 'White wine · bottle', 35, 8, false),
  ('malvasia-c', 'vino', 'Malvasia · calice', 'White wine · glass', 9, 9, false),
  ('malvasia-b', 'vino', 'Malvasia · bottiglia', 'White wine · bottle', 35, 10, false),
  ('rosso-c', 'vino', 'Montepulciano d''Abruzzo · calice', 'Red wine · glass', 8, 11, false),
  ('rosso-b', 'vino', 'Montepulciano d''Abruzzo · bottiglia', 'Red wine · bottle', 32, 12, false),
  ('syrah-c', 'vino', 'Syrah Divina · calice', 'Red wine · glass', 10, 13, false),
  ('syrah-b', 'vino', 'Syrah Divina · bottiglia', 'Red wine · bottle', 40, 14, false),
  ('merlot-c', 'vino', 'Merlot Villa Dugo FVG 2024 · calice', 'Red wine, Friuli Venezia Giulia 2024 · glass', 9, 15, false),
  ('merlot-b', 'vino', 'Merlot Villa Dugo FVG 2024 · bottiglia', 'Red wine, Friuli Venezia Giulia 2024 · bottle', 38, 16, false),
  ('prosecco-c', 'vino', 'Prosecco Gemin DOC Treviso Extra Dry · calice', 'Sparkling wine · glass', 9, 17, false),
  ('prosecco-b', 'vino', 'Prosecco Gemin DOC Treviso Extra Dry · bottiglia', 'Sparkling wine · bottle', 29, 18, false),
  ('champ-mumm', 'champagne', 'Grand Cordon Mumm', 'Champagne · bottle', 95, 1, false),
  ('franciacorta-magnum', 'champagne', 'Franciacorta Magnum 1,5 L · Tenuta Martinelli Brut DOCG', 'Franciacorta Magnum 1.5 L · bottle', 140, 2, false),
  ('champ-moet-rosso', 'champagne', 'Moët & Chandon Impérial Rosso', 'Champagne · bottle', 180, 3, false),
  ('birra-peroni', 'vino', 'Birra Peroni', 'Peroni beer', 8, 19, false),
  ('birra-ichnusa', 'vino', 'Birra Ichnusa 0,5 L', 'Ichnusa beer 0.5 L', 9.5, 20, false),
  ('limoncello', 'liquori', 'Limoncello di Capri', 'Lemon liqueur', 10, 1, false),
  ('jager', 'liquori', 'Amaro Jägermeister', 'Herbal liqueur', 10, 2, false),
  ('jefferson', 'liquori', 'Amaro Jefferson', 'Herbal liqueur', 11, 3, false),
  ('jack', 'liquori', 'Whisky Jack Daniel''s', 'Whiskey', 11, 4, false)
on conflict (id) do update set
  section = excluded.section, name_it = excluded.name_it, name_en = excluded.name_en,
  price = excluded.price, sort = excluded.sort, hidden = false, updated_at = now();

-- everything else: hidden (not deleted). Custom drinks keep their place at the end of their section.
update public.menu_items set hidden = true, updated_at = now()
where id not in ('lasagne', 'spag-pom', 'pasta-speck', 'zuppa', 'carbonara', 'risotto', 'ravioli', 'polpette', 'filetto', 'cotoletta', 'souffle-cioc', 'souffle-pist', 'tiramisu', 'pinsa-rosmarino', 'pinsa-mortadella', 'pinsa-cotto', 'pinsa-speck', 'pinsa-bresaola', 'pinsa-tricolore', 'aperitif', 'espresso', 'decaf', 'orzo', 'ginseng', 'americano', 'cappuccino', 'te-verde', 'te-nero', 'te-earl', 'cioccolata', 'spremuta', 'redbull', 'acqua', 'coca', 'coca-zero', 'fanta', 'schweppes', 'manhattan', 'aperol', 'campari', 'limoncello-spritz', 'mojito', 'cuba', 'gin-tonic', 'vodka-tonic', 'americano-ck', 'negroni', 'spum-c', 'spum-b', 'bianco-c', 'bianco-b', 'gewurz-c', 'gewurz-b', 'rosso-c', 'rosso-b', 'syrah-c', 'syrah-b', 'ribolla-c', 'ribolla-b', 'malvasia-c', 'malvasia-b', 'merlot-c', 'merlot-b', 'prosecco-c', 'prosecco-b', 'champ-mumm', 'franciacorta-magnum', 'champ-moet-rosso', 'birra-peroni', 'birra-ichnusa', 'limoncello', 'jager', 'jefferson', 'jack')
  and name_it not ilike '%su misura%' and id not like '%misura%'
  and hidden = false;

update public.menu_items set sort = 99, updated_at = now()
where (name_it ilike '%su misura%' or id like '%misura%');
