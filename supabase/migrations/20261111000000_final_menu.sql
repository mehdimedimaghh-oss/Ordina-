-- =====================================================================
--  FINAL MENU (from the owner's new menus): run once in Supabase → SQL Editor → Run.
--  Safe to run again. Nothing is deleted: dishes not on the new menu are only HIDDEN
--  (old orders keep their names). The custom drinks ("… su misura") are not touched.
--  After running it, every tablet and phone shows the new menu by itself.
-- =====================================================================

insert into public.menu_items(id, section, name_it, name_en, price, sort, hidden) values
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
  ('rosso-c', 'vino', 'Montepulciano d''Abruzzo · calice', 'Red wine · glass', 8, 7, false),
  ('rosso-b', 'vino', 'Montepulciano d''Abruzzo · bottiglia', 'Red wine · bottle', 32, 8, false),
  ('syrah-c', 'vino', 'Syrah Divina · calice', 'Red wine · glass', 10, 9, false),
  ('syrah-b', 'vino', 'Syrah Divina · bottiglia', 'Red wine · bottle', 40, 10, false),
  ('prosecco-c', 'vino', 'Prosecco Gemin DOC Treviso Extra Dry · calice', 'Sparkling wine · glass', 9, 11, false),
  ('prosecco-b', 'vino', 'Prosecco Gemin DOC Treviso Extra Dry · bottiglia', 'Sparkling wine · bottle', 29, 12, false),
  ('birra', 'vino', 'Birra 0,33 cl', 'Beer', 6.5, 13, false),
  ('limoncello', 'liquori', 'Limoncello di Capri', 'Lemon liqueur', 8.5, 1, false),
  ('jager', 'liquori', 'Amaro Jägermeister', 'Herbal liqueur', 8.5, 2, false),
  ('jefferson', 'liquori', 'Amaro Jefferson', 'Herbal liqueur', 11, 3, false),
  ('jack', 'liquori', 'Whisky Jack Daniel''s', 'Whiskey', 11, 4, false)
on conflict (id) do update set
  section = excluded.section, name_it = excluded.name_it, name_en = excluded.name_en,
  price = excluded.price, sort = excluded.sort, hidden = false, updated_at = now();

-- everything else: hidden (not deleted). Custom drinks keep their place at the end of their section.
update public.menu_items set hidden = true, updated_at = now()
where id not in ('spag-pom', 'pasta-speck', 'zuppa', 'carbonara', 'risotto', 'ravioli', 'polpette', 'filetto', 'cotoletta', 'souffle-cioc', 'souffle-pist', 'tiramisu', 'pinsa-rosmarino', 'pinsa-mortadella', 'pinsa-cotto', 'pinsa-speck', 'pinsa-bresaola', 'pinsa-tricolore', 'aperitif', 'espresso', 'decaf', 'orzo', 'ginseng', 'americano', 'cappuccino', 'te-verde', 'te-nero', 'te-earl', 'cioccolata', 'spremuta', 'redbull', 'acqua', 'coca', 'coca-zero', 'fanta', 'schweppes', 'manhattan', 'aperol', 'campari', 'limoncello-spritz', 'mojito', 'cuba', 'gin-tonic', 'vodka-tonic', 'americano-ck', 'negroni', 'spum-c', 'spum-b', 'bianco-c', 'bianco-b', 'gewurz-c', 'gewurz-b', 'rosso-c', 'rosso-b', 'syrah-c', 'syrah-b', 'prosecco-c', 'prosecco-b', 'birra', 'limoncello', 'jager', 'jefferson', 'jack')
  and name_it not ilike '%su misura%' and id not like '%misura%'
  and hidden = false;

update public.menu_items set sort = 99, updated_at = now()
where (name_it ilike '%su misura%' or id like '%misura%');
