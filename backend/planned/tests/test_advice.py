"""Советчик «как накопить» — чистые расчёты поверх ``goals.forecast``; сегодня — 13 октября 2026."""
from datetime import date, timedelta
from decimal import ROUND_UP, Decimal

from django.test import SimpleTestCase

from goals import forecast
from planned import advice

D = Decimal
TODAY = date(2026, 10, 13)
RATES = {"fixed": D("17"), "flexible": D("15"), "invest": D("10")}
CENT = D("0.01")


def by_key(result):
    return {option["key"]: option for option in result["options"]}


class HorizonTests(SimpleTestCase):
    def test_months_until_due(self):
        self.assertIsNone(advice.horizon(None, TODAY))
        self.assertEqual(advice.horizon(TODAY + timedelta(days=10), TODAY), 1)
        self.assertEqual(advice.horizon(TODAY + timedelta(days=91), TODAY), 3)
        self.assertEqual(advice.horizon(date(2027, 12, 13), TODAY), 14)
        self.assertEqual(advice.horizon(TODAY, TODAY), 0)
        self.assertEqual(advice.horizon(TODAY - timedelta(days=1), TODAY), 0)


class OptionsTests(SimpleTestCase):
    def options(self, due, need="100000", saved="0"):
        return advice.options(D(need), D(saved), due, TODAY, RATES)

    def test_without_a_due_only_the_flexible_deposit_with_a_round_contribution(self):
        result = self.options(None, need="123456")
        self.assertEqual((result["missing"], result["months"]), (D("123456"), None))
        options = by_key(result)
        self.assertEqual([option["available"] for option in result["options"]], [False, True, False])
        flexible = options["monthly_flexible"]
        # 10 % от суммы, округлённо вверх до двух значащих цифр: 12 345,6 → 13 000; хватит через K месяцев.
        self.assertEqual(flexible["amount"], D("13000"))
        months = forecast.months_to(forecast.State(), D("15"), True, D("123456"), D("13000"))
        self.assertEqual(flexible["times"], months)
        self.assertEqual(flexible["until"], advice.shift_month(TODAY, months))
        self.assertEqual(flexible["gain"], D("123456") - D("13000") * months)
        self.assertEqual((options["lump_fixed"]["amount"], options["invest"]["amount"]), (None, None))
        self.assertTrue(options["lump_fixed"]["reason"] and options["invest"]["reason"])

    def test_ten_days_only_the_flexible_deposit(self):
        due = TODAY + timedelta(days=10)
        options = by_key(self.options(due))
        self.assertEqual({key: option["available"] for key, option in options.items()},
                         {"lump_fixed": False, "monthly_flexible": True, "invest": False})
        flexible = options["monthly_flexible"]
        expected = forecast.need(forecast.State(), D("15"), True, 1, D("100000")).quantize(CENT, ROUND_UP)
        self.assertEqual((flexible["amount"], flexible["times"], flexible["until"], flexible["rate"], flexible["risk"],
                          flexible["liquid"]), (expected, 1, due, D("15"), 1, True))
        self.assertEqual(flexible["gain"], D("100000") - expected)

    def test_three_months_add_the_fixed_deposit(self):
        due = TODAY + timedelta(days=91)
        result = self.options(due, saved="20000")
        self.assertEqual((result["need"], result["saved"], result["missing"], result["months"], result["due"]),
                         (D("100000"), D("20000"), D("80000"), 3, due))
        options = by_key(result)
        self.assertEqual({key: option["available"] for key, option in options.items()},
                         {"lump_fixed": True, "monthly_flexible": True, "invest": False})
        lump = options["lump_fixed"]
        # Одна сумма сегодня, которая с процентами срочного вклада за 3 месяца даст недостающее.
        factor = forecast.project(forecast.State(D(1)), D("17"), True, 3).total
        expected = (D("80000") / factor).quantize(CENT, ROUND_UP)
        self.assertEqual((lump["amount"], lump["times"], lump["gain"], lump["rate"], lump["risk"], lump["liquid"],
                          lump["until"]), (expected, 1, D("80000") - expected, D("17"), 1, False, due))
        self.assertEqual(options["monthly_flexible"]["times"], 3)

    def test_over_a_year_adds_investing(self):
        due = date(2027, 12, 13)
        options = by_key(self.options(due))
        self.assertTrue(all(option["available"] for option in options.values()))
        invest = options["invest"]
        expected = forecast.need(forecast.State(), D("10"), True, 14, D("100000")).quantize(CENT, ROUND_UP)
        self.assertEqual((invest["amount"], invest["times"], invest["rate"], invest["risk"], invest["liquid"]),
                         (expected, 14, D("10"), 3, True))

    def test_due_passed_or_nothing_missing(self):
        for due, saved in ((TODAY, "0"), (TODAY - timedelta(days=3), "0"), (date(2027, 12, 13), "100000")):
            with self.subTest(due=due, saved=saved):
                result = self.options(due, saved=saved)
                self.assertFalse(any(option["available"] for option in result["options"]))
                self.assertTrue(all(option["reason"] for option in result["options"]))

    def test_rounding_up_to_two_significant_digits(self):
        self.assertEqual([advice.nice(D(value)) for value in ("12345.6", "5000", "50", "0.5", "999", "1")],
                         [D("13000"), D("5000"), D("50"), D("0.5"), D("1000"), D("1")])
